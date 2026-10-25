/**
 * Infrastructure read side: Postgres internals (pg_stat_*), app process,
 * Redis/cache, disk, external dependency configuration + last outcome.
 * Every section degrades independently — one failing query never blanks the tab.
 */
import fs from 'node:fs';
import { ts } from './sql-time';
import path from 'node:path';
import { prisma } from '../db';
import { redactText } from './redact';
import { processSnapshot } from './process-stats';

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function dbConnections(): Promise<{ total: number; max: number; byState: Record<string, number>; waiting: number } | null> {
  return safe(async () => {
    const [rows, max, waiting] = await Promise.all([
      prisma.$queryRaw<Array<{ state: string | null; n: bigint }>>`
        SELECT COALESCE(state, 'background') AS state, COUNT(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() GROUP BY 1`,
      prisma.$queryRaw<Array<{ max_connections: string }>>`SHOW max_connections`,
      prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    ]);
    const byState: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byState[r.state ?? 'unknown'] = Number(r.n);
      total += Number(r.n);
    }
    return { total, max: Number(max[0]?.max_connections ?? 100), byState, waiting: Number(waiting[0]?.n ?? 0) };
  }, null);
}

export async function diskFree(): Promise<{ path: string; totalGB: number; freeGB: number; freePct: number } | null> {
  const candidates = [process.env.UPLOAD_DIR, path.join(process.cwd(), 'public', 'uploads'), process.cwd()].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      const st = fs.statfsSync(p);
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      if (total <= 0) continue;
      return {
        path: p === process.cwd() ? 'app directory' : p.replace(process.cwd(), '.'),
        totalGB: Math.round((total / 1073741824) * 10) / 10,
        freeGB: Math.round((free / 1073741824) * 10) / 10,
        freePct: Math.round((free / total) * 1000) / 10,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function database() {
  const [conn, longest, size, tables, cacheHit, pss] = await Promise.all([
    dbConnections(),
    safe(
      () => prisma.$queryRaw<Array<{ pid: number; state: string; secs: number; wait: string | null; query: string }>>`
        SELECT pid, state, EXTRACT(EPOCH FROM (now() - query_start))::float8 AS secs,
               wait_event_type AS wait, LEFT(query, 400) AS query
        FROM pg_stat_activity
        WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid() AND query_start IS NOT NULL
        ORDER BY query_start ASC LIMIT 10`,
      [],
    ),
    safe(() => prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`, []),
    safe(
      () => prisma.$queryRaw<Array<{ name: string; bytes: bigint; live: bigint; dead: bigint; ins: bigint; lastvac: Date | null }>>`
        SELECT relname AS name, pg_total_relation_size(relid) AS bytes, n_live_tup AS live, n_dead_tup AS dead,
               n_tup_ins AS ins, GREATEST(last_autovacuum, last_vacuum) AS lastvac
        FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20`,
      [],
    ),
    safe(
      () => prisma.$queryRaw<Array<{ ratio: number | null }>>`
        SELECT CASE WHEN blks_hit + blks_read = 0 THEN NULL ELSE blks_hit::float8 / (blks_hit + blks_read) END AS ratio
        FROM pg_stat_database WHERE datname = current_database()`,
      [],
    ),
    safe(async () => {
      const ext = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM pg_extension WHERE extname = 'pg_stat_statements'`;
      if (!Number(ext[0]?.n)) return { available: false as const, rows: [] };
      const rows = await prisma.$queryRawUnsafe<Array<{ query: string; calls: bigint; mean: number; total: number }>>(
        `SELECT LEFT(query, 400) AS query, calls, mean_exec_time AS mean, total_exec_time AS total
         FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
         ORDER BY mean_exec_time DESC LIMIT 10`,
      );
      return { available: true as const, rows };
    }, { available: false as const, rows: [] }),
  ]);

  // Table growth vs the last daily snapshot written by the retention job.
  const snap = await safe(() => prisma.obsProbe.findUnique({ where: { target: 'db:table-sizes' }, select: { meta: true } }), null);
  const prev = ((snap?.meta as { prev?: { at: string; sizes: Record<string, number> } } | null)?.prev ?? null) as
    | { at: string; sizes: Record<string, number> }
    | null;

  return {
    connections: conn,
    sizeMB: size[0] ? Math.round(Number(size[0].bytes) / 1048576) : null,
    cacheHitRatio: cacheHit[0]?.ratio ?? null,
    longestQueries: longest.map((q) => ({
      pid: q.pid,
      state: q.state,
      seconds: Math.round(q.secs * 10) / 10,
      wait: q.wait,
      query: redactText(q.query, 400),
    })),
    tables: tables.map((t) => {
      const mb = Math.round((Number(t.bytes) / 1048576) * 10) / 10;
      const live = Number(t.live);
      const dead = Number(t.dead);
      const prevMb = prev?.sizes?.[t.name];
      return {
        name: t.name,
        sizeMB: mb,
        liveRows: live,
        deadRows: dead,
        deadPct: live + dead ? Math.round((dead / (live + dead)) * 1000) / 10 : 0,
        insertsSinceReset: Number(t.ins),
        lastVacuumAt: t.lastvac?.toISOString() ?? null,
        growthMB: typeof prevMb === 'number' ? Math.round((mb - prevMb) * 10) / 10 : null,
      };
    }),
    growthSince: prev?.at ?? null,
    statements: {
      available: pss.available,
      note: pss.available
        ? null
        : 'pg_stat_statements is not installed — showing longest-running live queries instead. Enable with shared_preload_libraries + CREATE EXTENSION pg_stat_statements.',
      rows: pss.rows.map((r) => ({
        query: redactText(r.query, 400),
        calls: Number(r.calls),
        meanMs: Math.round(Number(r.mean) * 10) / 10,
        totalMs: Math.round(Number(r.total)),
      })),
    },
  };
}

/** Daily snapshot of table sizes (MB) for growth tracking. Called by the retention job. */
export async function snapshotTableSizes(): Promise<void> {
  try {
    const rows = await prisma.$queryRaw<Array<{ name: string; bytes: bigint }>>`
      SELECT relname AS name, pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables`;
    const sizes: Record<string, number> = {};
    for (const r of rows) sizes[r.name] = Math.round((Number(r.bytes) / 1048576) * 10) / 10;
    const existing = await prisma.obsProbe.findUnique({ where: { target: 'db:table-sizes' }, select: { meta: true } });
    const cur = (existing?.meta as { at?: string; sizes?: Record<string, number> } | null) ?? null;
    const meta = { at: new Date().toISOString(), sizes, prev: cur?.at ? { at: cur.at, sizes: cur.sizes ?? {} } : null };
    await prisma.obsProbe.upsert({
      where: { target: 'db:table-sizes' },
      create: { target: 'db:table-sizes', category: 'DATABASE', label: 'Table size snapshot', status: 'UP', meta, detail: `${rows.length} tables` },
      update: { meta, checkedAt: new Date(), detail: `${rows.length} tables` },
    });
  } catch {
    /* best-effort */
  }
}

/** Channel → configured provider (mirrors the env fallback in notifications.ts). */
export function notifierConfig() {
  const sms = (process.env.NOTIFIER_SMS || process.env.SMS_PROVIDER || 'mock').toLowerCase();
  const email = (process.env.NOTIFIER_EMAIL || process.env.EMAIL_PROVIDER || (process.env.SMTP_HOST ? 'smtp' : 'mock')).toLowerCase();
  const whatsapp = (process.env.NOTIFIER_WHATSAPP || 'mock').toLowerCase();
  const push = process.env.VAPID_PUBLIC_KEY || process.env.EXPO_ACCESS_TOKEN ? 'configured' : 'mock';
  return { SMS: sms, EMAIL: email, WHATSAPP: whatsapp, PUSH: push } as Record<string, string>;
}

/** Production = NODE_ENV production and not the demo instance. */
export function isProductionInstance(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true';
}

async function externalDependencies() {
  const cfg = notifierConfig();
  const lastBy = await safe(
    () => prisma.$queryRaw<Array<{ channel: string; status: string; at: Date }>>`
      SELECT channel::text AS channel, status::text AS status, MAX("createdAt") AS at
      FROM "NotificationLog" WHERE "createdAt" >= (now() AT TIME ZONE 'UTC') - interval '7 days' GROUP BY 1, 2`,
    [],
  );
  const lastAt = (channel: string, status: string) => lastBy.find((r) => r.channel === channel && r.status === status)?.at?.toISOString() ?? null;
  const deps = (['SMS', 'EMAIL', 'WHATSAPP', 'PUSH'] as const).map((ch) => ({
    key: `notify:${ch.toLowerCase()}`,
    label: { SMS: 'SMS gateway', EMAIL: 'E-mail (SMTP)', WHATSAPP: 'WhatsApp', PUSH: 'Push notifications' }[ch],
    configured: cfg[ch] !== 'mock',
    detail: cfg[ch] === 'mock' ? 'Mock — messages are only journaled, not delivered (env default; per-restaurant integrations may override)' : `Provider: ${cfg[ch]}`,
    lastSuccessAt: lastAt(ch, 'SENT'),
    lastFailureAt: lastAt(ch, 'FAILED'),
  }));
  const lastReviewSync = await safe(() => prisma.googleReview.aggregate({ _max: { syncedAt: true } }), null);
  deps.push(
    {
      key: 'google:maps',
      label: 'Google Maps',
      configured: !!(process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
      detail: process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? 'API key set' : 'No key — OSM/Leaflet fallback',
      lastSuccessAt: null,
      lastFailureAt: null,
    },
    {
      key: 'google:oauth',
      label: 'Google sign-in',
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      detail: process.env.GOOGLE_CLIENT_ID ? 'OAuth client configured' : 'Not configured',
      lastSuccessAt: null,
      lastFailureAt: null,
    },
    {
      key: 'google:business',
      label: 'Google Business reviews',
      configured: !!lastReviewSync?._max.syncedAt,
      detail: lastReviewSync?._max.syncedAt ? 'Reviews syncing' : 'No synced reviews yet (needs per-restaurant Google Business connection)',
      lastSuccessAt: lastReviewSync?._max.syncedAt?.toISOString() ?? null,
      lastFailureAt: null,
    },
    {
      key: 'storage',
      label: 'File storage',
      configured: true,
      detail: process.env.STORAGE_DRIVER === 's3' ? `S3 bucket ${process.env.S3_BUCKET ? 'set' : 'MISSING'}` : 'Local disk (public/uploads)',
      lastSuccessAt: null,
      lastFailureAt: null,
    },
  );
  return deps;
}

export async function infraSnapshot() {
  const [db, disk, cache, probes, deps] = await Promise.all([
    database(),
    diskFree(),
    safe(async () => {
      const { checkCacheHealth, cacheMetrics } = await import('../cache');
      return { health: await checkCacheHealth(), metrics: cacheMetrics.snapshot() };
    }, null),
    safe(() => prisma.obsProbe.findMany({ where: { NOT: { target: 'db:table-sizes' } }, orderBy: [{ category: 'asc' }, { label: 'asc' }] }), []),
    externalDependencies(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    process: processSnapshot(),
    db,
    disk,
    cache,
    probes: probes.map((p) => ({
      target: p.target,
      category: p.category,
      label: p.label,
      status: p.status,
      latencyMs: p.latencyMs,
      detail: p.detail,
      consecutiveFailures: p.consecutiveFailures,
      checkedAt: p.checkedAt.toISOString(),
    })),
    dependencies: deps,
  };
}
