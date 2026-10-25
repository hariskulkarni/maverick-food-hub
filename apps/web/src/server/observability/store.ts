/**
 * Observability store — the write side of the self-contained telemetry system.
 *
 * Everything here is BEST-EFFORT and must NEVER throw into the caller: telemetry
 * failing must not break a request or a probe cycle. All writes are wrapped.
 */
import crypto from 'node:crypto';
import { prisma } from '../db';
import { redactText, normalizeForFingerprint, stackSignature } from './redact';
import { currentRequest } from './request-context';

export type ObsLevel = 'ERROR' | 'WARN' | 'INFO';
export type ObsStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
export type ObsCategory =
  | 'SYSTEM'
  | 'DATABASE'
  | 'SSL'
  | 'DOMAIN'
  | 'INTEGRATION'
  | 'ROUTE'
  | 'APP'
  | 'REALTIME';

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

/**
 * Stable group key: level + kind + where + the NORMALISED message (ids/numbers
 * stripped) + the top in-app stack frames. So "Order c1… not found" and
 * "Order c2… not found" thrown from the same place collapse into one group,
 * and the group survives a redeploy (no line numbers / chunk hashes).
 */
export function fingerprintOf(level: string, kind: string, source: string, message: string, stack?: string | null): string {
  return crypto
    .createHash('sha256')
    .update(`${level}|${kind}|${source}|${normalizeForFingerprint(message)}|${stackSignature(stack)}`)
    .digest('hex')
    .slice(0, 48);
}

export type ObsErrorKind = 'SERVER' | 'CLIENT' | 'NATIVE';

export interface RecordErrorInput {
  level?: ObsLevel;
  kind?: ObsErrorKind;
  source: string; // where: route path / component / module
  message: string; // what
  digest?: string | null;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  statusCode?: number | null;
  userId?: string | null;
  requestId?: string | null;
}

export function appRelease(): string | null {
  return (process.env.APP_COMMIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION || process.env.npm_package_version || '').slice(0, 40) || null;
}

/**
 * Record (and dedupe) an error. Repeats collapse into one row with a count.
 * Message, stack and path are REDACTED before anything is stored. The current
 * request (id, method, path, route) is attached automatically when available.
 */
export async function recordError(e: RecordErrorInput): Promise<void> {
  try {
    const ctx = currentRequest();
    const level = e.level ?? 'ERROR';
    const kind = e.kind ?? 'SERVER';
    const message = redactText(e.message || 'Unknown error', MAX_MESSAGE);
    const stack = e.stack ? redactText(e.stack, MAX_STACK) : null;
    const route = (e.route ?? ctx?.route ?? null)?.slice(0, 200) ?? null;
    const source = redactText(e.source || route || 'unknown', 300);
    const path = e.path ?? ctx?.path ?? null;
    const safePath = path ? redactText(path.split('?')[0], 300) : null;
    const method = e.method ?? ctx?.method ?? null;
    const requestId = (e.requestId ?? ctx?.requestId ?? null)?.slice(0, 64) ?? null;
    const fingerprint = fingerprintOf(level, kind, route ?? source, message, stack);
    const now = new Date();
    const release = appRelease();
    await prisma.obsErrorLog.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        level,
        kind,
        source,
        message,
        digest: e.digest ?? null,
        sampleStack: stack,
        method,
        path: safePath,
        route,
        statusCode: e.statusCode ?? null,
        userId: e.userId ?? null,
        requestId,
        release,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: now,
        // Refresh the sample with the most recent occurrence's detail.
        message,
        sampleStack: stack ?? undefined,
        statusCode: e.statusCode ?? undefined,
        method: method ?? undefined,
        path: safePath ?? undefined,
        requestId: requestId ?? undefined,
        release: release ?? undefined,
        // A previously-resolved error that recurs is un-resolved (regression).
        resolvedAt: null,
      },
    });
  } catch {
    /* telemetry must never throw */
  }
}

export interface RecordProbeInput {
  target: string;
  category: ObsCategory;
  label: string;
  status: ObsStatus;
  latencyMs?: number | null;
  detail?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Upsert the current probe state for a target and append a history event. */
export async function recordProbe(p: RecordProbeInput): Promise<void> {
  try {
    const prev = await prisma.obsProbe.findUnique({ where: { target: p.target }, select: { consecutiveFailures: true } });
    const consecutiveFailures = p.status === 'DOWN' ? (prev?.consecutiveFailures ?? 0) + 1 : 0;
    const now = new Date();
    await prisma.obsProbe.upsert({
      where: { target: p.target },
      create: {
        target: p.target,
        category: p.category,
        label: p.label,
        status: p.status,
        latencyMs: p.latencyMs ?? null,
        detail: p.detail ?? null,
        meta: (p.meta ?? undefined) as object | undefined,
        consecutiveFailures,
        checkedAt: now,
      },
      update: {
        category: p.category,
        label: p.label,
        status: p.status,
        latencyMs: p.latencyMs ?? null,
        detail: p.detail ?? null,
        meta: (p.meta ?? undefined) as object | undefined,
        consecutiveFailures,
        checkedAt: now,
      },
    });
    await prisma.obsProbeEvent.create({
      data: { target: p.target, status: p.status, latencyMs: p.latencyMs ?? null, detail: p.detail ?? null },
    });
  } catch {
    /* telemetry must never throw */
  }
}

/** Prune probe history older than `days` (keep the table bounded). Best-effort. */
export async function pruneProbeHistory(days = 7): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await prisma.obsProbeEvent.deleteMany({ where: { at: { lt: cutoff } } });
  } catch {
    /* ignore */
  }
}
