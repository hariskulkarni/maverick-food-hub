/**
 * HTTP-level recorder — golden signals for EVERY request with zero per-route code.
 *
 * Why here (and not middleware / per-route wrappers):
 *   • Next middleware runs on the Edge runtime before the handler and cannot see
 *     the handler's duration or final status.
 *   • Wrapping ~300 route files is invasive and would silently miss new routes.
 *   • `next start` serves every request from one Node http.Server, so wrapping
 *     its 'request' event sees the true end-to-end latency and final status of
 *     every route — including middleware-generated 401/403/429 responses.
 *
 * Trade-off: route grouping needs the build manifest (see routes.ts); paths that
 * don't match fall back to an id-stripping heuristic. Cost per request: an ALS
 * context, a cached route lookup and a few integer increments (~µs); the DB
 * sees one batched upsert per flush, never a per-request write.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { recordRequest, incEvent } from './aggregator';
import { classifyPath, routeTemplate, jobNameFromPath } from './routes';
import { requestStore } from './request-context';
import { recordJobStart, recordJobFinish, summarizeJobBody } from './jobs';

declare global {
  // eslint-disable-next-line no-var
  var __obsHttpPatched: boolean | undefined;
}

const routeCache = new Map<string, string>();
const ROUTE_CACHE_MAX = 5000;

function cachedRoute(pathname: string): string {
  const hit = routeCache.get(pathname);
  if (hit) return hit;
  const t = routeTemplate(pathname);
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.clear();
  routeCache.set(pathname, t);
  return t;
}

const REQ_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Best-effort role of the caller behind a 403 (decodes the session cookie). */
async function roleOf(req: http.IncomingMessage): Promise<string> {
  try {
    const authz = req.headers.authorization;
    if (typeof authz === 'string' && authz.startsWith('Bearer ')) return 'BEARER';
    const cookie = req.headers.cookie ?? '';
    if (!/authjs\.session-token|next-auth\.session-token/.test(cookie)) return 'ANON';
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) return 'UNKNOWN';
    const { getToken } = await import('next-auth/jwt');
    const headers = new Headers();
    headers.set('cookie', cookie);
    for (const secureCookie of [true, false]) {
      const tok = (await getToken({ req: { headers }, secret, secureCookie } as never).catch(() => null)) as { role?: string } | null;
      if (tok?.role) return String(tok.role);
    }
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/** Capture the first few KB of a response body (job routes only). */
function tapBody(res: http.ServerResponse, limit = 4096): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  const take = (chunk: unknown, enc?: unknown) => {
    if (size >= limit || chunk == null || typeof chunk === 'function') return;
    const b = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === 'string'
        ? Buffer.from(chunk, (typeof enc === 'string' ? enc : 'utf8') as BufferEncoding)
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : null;
    if (!b) return;
    chunks.push(b.subarray(0, limit - size));
    size += Math.min(b.length, limit - size);
  };
  const origWrite = res.write.bind(res) as (...a: unknown[]) => boolean;
  const origEnd = res.end.bind(res) as (...a: unknown[]) => http.ServerResponse;
  (res as unknown as { write: (...a: unknown[]) => boolean }).write = (...a: unknown[]) => {
    take(a[0], a[1]);
    return origWrite(...a);
  };
  (res as unknown as { end: (...a: unknown[]) => http.ServerResponse }).end = (...a: unknown[]) => {
    take(a[0], a[1]);
    return origEnd(...a);
  };
  return () => Buffer.concat(chunks).toString('utf8');
}

function onRequest(req: http.IncomingMessage, res: http.ServerResponse, run: () => boolean): boolean {
  const url = req.url || '/';
  const pathname = url.split('?')[0] || '/';
  const kind = classifyPath(pathname);
  if (!kind) return run();

  const startedAt = Date.now();
  const t0 = performance.now();
  const method = (req.method || 'GET').toUpperCase();
  const route = cachedRoute(pathname);
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && REQ_ID_RE.test(incoming) ? incoming : randomUUID();
  try {
    res.setHeader('x-request-id', requestId);
  } catch {
    /* headers already sent */
  }

  const job = method === 'POST' || method === 'GET' ? jobNameFromPath(pathname) : null;
  let jobRunId: Promise<string | null> | null = null;
  let readBody: (() => string) | null = null;
  if (job) {
    jobRunId = recordJobStart(job, req.headers['x-internal-secret'] ? 'CRON' : 'MANUAL', requestId);
    readBody = tapBody(res);
  }

  let done = false;
  const finish = (aborted: boolean) => {
    if (done) return;
    done = true;
    try {
      const status = aborted && !res.writableFinished ? 499 : res.statusCode || 200;
      const durationMs = performance.now() - t0;
      const ctype = String(res.getHeader('content-type') ?? '');
      if (!ctype.includes('text/event-stream')) {
        recordRequest({ method, route, kind, status, durationMs, at: startedAt });
      }
      if (status === 403) {
        void roleOf(req).then((role) => incEvent('denied', route, role));
      }
      if (pathname.includes('/webhook') && (status === 400 || status === 401 || status === 403)) {
        incEvent('webhook_reject', route, String(status));
      }
      if (jobRunId && readBody) {
        const body = readBody();
        const ok = status >= 200 && status < 300;
        const { summary, error } = summarizeJobBody(body, ok);
        void jobRunId.then((id) =>
          recordJobFinish(id, { ok, startedAt, httpStatus: status, summary, error: error ?? (ok ? null : `HTTP ${status}`) }),
        );
      }
    } catch {
      /* telemetry must never throw */
    }
  };
  res.once('finish', () => finish(false));
  res.once('close', () => finish(true));

  return requestStore().run({ requestId, method, path: pathname, route, startedAt }, run);
}

/** Install once per process. Safe to call repeatedly. */
export function installHttpRecorder(): void {
  if (global.__obsHttpPatched) return;
  global.__obsHttpPatched = true;
  const proto = http.Server.prototype as unknown as { emit: (event: string, ...args: unknown[]) => boolean };
  const origEmit = proto.emit;
  proto.emit = function patchedEmit(this: unknown, event: string, ...args: unknown[]): boolean {
    if (event !== 'request') return origEmit.call(this, event, ...args);
    const run = () => origEmit.call(this, event, ...args);
    try {
      return onRequest(args[0] as http.IncomingMessage, args[1] as http.ServerResponse, run);
    } catch {
      return run();
    }
  };
}

/** Exposed for tests. */
export const __test = { onRequest, roleOf };
