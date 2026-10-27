/**
 * Platform rider location-integrity (anti-fraud) review queue.
 *
 *   GET  — the queue of suspect riders + the current anti-fraud policy.
 *          Gate: riders:read.
 *   POST — review action on one rider (clear | keep | pause | resume). Audited.
 *          Gate: riders:write.
 *   PUT  — update the anti-fraud policy (mock threshold + default-off
 *          enforcement toggles). Audited. Gate: riders:write.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireCapabilityApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { audit } from '@/server/audit';
import { getIntegrityConfig, updateIntegrityConfig } from '@/server/rider-integrity/config';
import { listIntegrityQueue, reviewRider, type ReviewAction } from '@/server/rider-integrity/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireCapabilityApi('riders:read');
  if (gate instanceof Response) return gate;
  const includeCleared = req.nextUrl.searchParams.get('includeCleared') === '1';
  const [queue, config] = await Promise.all([listIntegrityQueue({ includeCleared }), getIntegrityConfig()]);
  return Response.json({ queue, config }, { headers: { 'Cache-Control': 'no-store' } });
}

const ActionBody = z.object({
  riderId: z.string().min(1).max(64),
  action: z.enum(['clear', 'keep', 'pause', 'resume']),
  note: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const gate = await requireCapabilityApi('riders:write');
  if (gate instanceof Response) return gate;
  const session = gate;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseOrJsonError(ActionBody, raw);
  if (parsed instanceof Response) return parsed;

  const result = await reviewRider(
    parsed.riderId,
    parsed.action as ReviewAction,
    session.user.id,
    parsed.note ?? null,
  );
  if (!result) return Response.json({ error: 'Rider has no integrity record' }, { status: 404 });

  await audit('rider.integrity.review', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderProfile',
    entityId: parsed.riderId,
    after: { action: parsed.action, note: parsed.note ?? null, ...result },
  });

  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

const ConfigBody = z.object({
  mockPingThreshold: z.number().int().min(1).max(100).optional(),
  autoPauseOffers: z.boolean().optional(),
  gateOnlineOnFailed: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const gate = await requireCapabilityApi('riders:write');
  if (gate instanceof Response) return gate;
  const session = gate;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseOrJsonError(ConfigBody, raw);
  if (parsed instanceof Response) return parsed;

  const before = await getIntegrityConfig();
  const after = await updateIntegrityConfig(parsed, session.user.id);
  await audit('rider.integrity.config.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderIntegrityConfig',
    before,
    after,
  });
  return Response.json(after, { headers: { 'Cache-Control': 'no-store' } });
}
