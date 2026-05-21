/**
 * Observability store — the write side of the self-contained telemetry system.
 *
 * Everything here is BEST-EFFORT and must NEVER throw into the caller: telemetry
 * failing must not break a request or a probe cycle. All writes are wrapped.
 */
import crypto from 'node:crypto';
import { prisma } from '../db';

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

function fingerprintOf(level: string, source: string, message: string, digest?: string | null): string {
  return crypto
    .createHash('sha256')
    .update(`${level}|${source}|${message}|${digest ?? ''}`)
    .digest('hex')
    .slice(0, 48);
}

export interface RecordErrorInput {
  level?: ObsLevel;
  source: string; // where: route path / component / module
  message: string; // what
  digest?: string | null;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  userId?: string | null;
}

/** Record (and dedupe) an error. Repeats collapse into one row with a count. */
export async function recordError(e: RecordErrorInput): Promise<void> {
  try {
    const level = e.level ?? 'ERROR';
    const message = (e.message || 'Unknown error').slice(0, MAX_MESSAGE);
    const source = (e.source || 'unknown').slice(0, 300);
    const fingerprint = fingerprintOf(level, source, message, e.digest);
    const now = new Date();
    await prisma.obsErrorLog.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        level,
        source,
        message,
        digest: e.digest ?? null,
        sampleStack: e.stack?.slice(0, MAX_STACK) ?? null,
        method: e.method ?? null,
        path: e.path ?? null,
        statusCode: e.statusCode ?? null,
        userId: e.userId ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: now,
        // Refresh the sample with the most recent occurrence's detail.
        sampleStack: e.stack?.slice(0, MAX_STACK) ?? undefined,
        statusCode: e.statusCode ?? undefined,
        method: e.method ?? undefined,
        path: e.path ?? undefined,
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
