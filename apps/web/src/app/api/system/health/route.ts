/**
 * GET /api/system/health
 *
 * Public-ish health endpoint for Uptime Kuma / Cloudflare health checks.
 * Returns `{ ok, db, uptime, version }`. No authentication required, but
 * IP-throttled via a tiny in-memory token bucket so it can't be used as a
 * DB-fingerprinting tool.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── In-memory rate limit ────────────────────────────────────────────────────
// Single-VPS deployment: this lives per process. PM2 fork mode = 1 process for
// rm-web, so the counter is consistent. If we scale to cluster mode, hits will
// be split N ways which is still fine for the limit values we use.
const WINDOW_MS = 60_000;          // 1 minute
const MAX_HITS = 30;               // 30 hits/minute/IP — plenty for any monitor
const hits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: NextRequest): string {
  // Cloudflare → nginx → Node: prefer CF-Connecting-IP, fall back through
  // X-Forwarded-For, then NextRequest.ip.
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const slot = hits.get(ip);
  if (!slot || slot.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (slot.count >= MAX_HITS) return false;
  slot.count += 1;
  return true;
}

// Best-effort housekeeping — sweep expired entries on each request so the map
// doesn't grow unbounded under spammy clients.
function gc() {
  const now = Date.now();
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}

export async function GET(req: NextRequest) {
  gc();
  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  let dbStatus: 'ok' | 'fail' = 'ok';
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch {
    dbStatus = 'fail';
  }

  const body = {
    ok: dbStatus === 'ok',
    db: dbStatus,
    uptime: Math.floor(process.uptime()),
    version: process.version
  };
  return NextResponse.json(body, {
    status: dbStatus === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' }
  });
}
