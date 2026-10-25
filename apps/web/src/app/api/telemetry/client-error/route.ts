/**
 * POST /api/telemetry/client-error — error beacon for the browser app shells and
 * the rider native app. Public by necessity (errors happen before/without login),
 * so it is hardened:
 *   • body ≤ 16 KB, JSON only, strict field caps;
 *   • rate-limited per IP (20/min) and globally (300/min, per process);
 *   • everything is redacted before storage (tokens, OTPs, e-mails, phones);
 *   • known browser noise (extensions, ResizeObserver, opaque "Script error.") dropped.
 * Always answers 204 (or 413/429) and never echoes input.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/server/http/client-ip';
import { recordError } from '@/server/observability/store';
import { recordClientErrorBeacon } from '@/server/observability/hooks';
import { routeTemplate } from '@/server/observability/routes';
import { allowBeacon } from '@/server/observability/beacon-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 16 * 1024;
const Body = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional().nullable(),
  componentStack: z.string().max(4000).optional().nullable(),
  source: z.enum(['web', 'rider-native']).default('web'),
  type: z.enum(['error', 'unhandledrejection', 'boundary', 'native-fatal', 'native']).default('error'),
  url: z.string().max(500).optional().nullable(),
  screen: z.string().max(120).optional().nullable(),
  release: z.string().max(60).optional().nullable(),
  platform: z.string().max(40).optional().nullable(),
});

const NOISE = [/ResizeObserver loop/i, /^Script error\.?$/i, /chrome-extension:|moz-extension:|safari-extension:/i, /Non-Error promise rejection captured/i];

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? 'unknown';
  if (!allowBeacon(ip)) return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) return new Response(null, { status: 413 });
  const raw = await req.text().catch(() => '');
  if (raw.length > MAX_BYTES) return new Response(null, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 204 });
  const b = parsed.data;
  if (NOISE.some((re) => re.test(b.message) || (b.stack ? re.test(b.stack) : false))) return new Response(null, { status: 204 });

  const native = b.source === 'rider-native';
  let route: string | null = null;
  let path: string | null = null;
  if (native) {
    route = `native:${(b.screen || 'app').replace(/[^A-Za-z0-9_/()[\]-]/g, '').slice(0, 80)}`;
  } else if (b.url) {
    try {
      path = new URL(b.url, 'https://x').pathname;
      route = routeTemplate(path);
    } catch {
      /* ignore */
    }
  }
  recordClientErrorBeacon(b.source);
  await recordError({
    level: 'ERROR',
    kind: native ? 'NATIVE' : 'CLIENT',
    source: `${native ? 'rider-app' : 'browser'} ${b.type}${route ? ` ${route}` : ''}`,
    message: b.message,
    stack: [b.stack, b.componentStack ? `Component stack:${b.componentStack}` : null].filter(Boolean).join('\n') || null,
    path,
    route,
    requestId: null,
    method: null,
  });
  return new Response(null, { status: 204 });
}
