/**
 * POST /api/rider/heartbeat
 *
 * Rider client pings this every ~30s while online. We upsert a RiderHeartbeat
 * row (one per rider) so the auto-offline sweep can flip stale riders.
 *
 * Returns `{ online }` — the server's view of the rider's online flag — so an
 * app that still shows "Online" after the auto-offline sweep flipped it (app
 * was backgrounded, phone asleep) can notice and tell the rider, instead of
 * believing it is live while the fleet map and dispatch treat it as offline.
 * The heartbeat itself never flips a rider back online: going online stays an
 * explicit rider action (POST /api/rider/online).
 *
 * Optional `device` (rider insights): model, OS, app version/build, network
 * type/generation, battery level/charging — validated strictly by
 * server/rider-insights/device.ts and stored only while the rider is online.
 * An invalid `device` is dropped without failing the heartbeat.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { parseDevice, recordDeviceContext } from '@/server/rider-insights/device';
import { markSignalRegained } from '@/server/rider-insights/status-events';

const Body = z.object({
  batteryLevel: z.number().int().min(0).max(100).optional(),
  gpsEnabled: z.boolean().optional(),
  appVersion: z.string().max(32).optional(),
  device: z.unknown().optional()
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, isOnline: true }
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  let payload: z.infer<typeof Body> = {};
  try {
    const text = await req.text();
    payload = text ? Body.parse(JSON.parse(text)) : {};
  } catch {
    // Tolerate empty / malformed bodies — heartbeat is the important bit.
    payload = {};
  }

  const device = parseDevice(payload.device);
  // Legacy top-level fields win; otherwise mirror the device context's values.
  if (device) {
    if (payload.batteryLevel === undefined && device.battery !== undefined) payload.batteryLevel = device.battery;
    if (payload.appVersion === undefined && device.appVersion !== undefined) payload.appVersion = device.appVersion;
  }

  const now = new Date();
  await markSignalRegained(profile.id, 'heartbeat');
  await prisma.riderHeartbeat.upsert({
    where: { riderId: profile.id },
    create: {
      riderId: profile.id,
      lastSeenAt: now,
      batteryLevel: payload.batteryLevel,
      gpsEnabled: payload.gpsEnabled ?? true,
      appVersion: payload.appVersion
    },
    update: {
      lastSeenAt: now,
      ...(payload.batteryLevel !== undefined ? { batteryLevel: payload.batteryLevel } : {}),
      ...(payload.gpsEnabled !== undefined ? { gpsEnabled: payload.gpsEnabled } : {}),
      ...(payload.appVersion !== undefined ? { appVersion: payload.appVersion } : {})
    }
  });
  if (device) await recordDeviceContext(profile.id, device, { online: profile.isOnline, now });

  return Response.json({ online: profile.isOnline }, { headers: { 'Cache-Control': 'no-store' } });
}
