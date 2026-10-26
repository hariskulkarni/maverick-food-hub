/**
 * Real-PostgreSQL proof that an online rider is actually tracked end to end:
 * rider app endpoints (online toggle, heartbeat, location — single foreground
 * points and background batches) → heartbeat sweep → the live-fleet snapshot
 * that /platform/live and its 4 s poll render. Route handlers and the sweep
 * run for real against the DB; only auth and the realtime fan-out are stubbed.
 *
 * Simulates the rider app's real cadence: heartbeat every 30 s while the app
 * is on screen, and (new) a background fix every ~30 s while online and idle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let session: any = null;
vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/auth', () => ({ auth: async () => session }));
vi.mock('@/server/realtime', () => ({ publish: () => {} }));
vi.mock('@/server/platform-settings', async (orig) => ({
  ...(await orig<typeof import('@/server/platform-settings')>()),
  getRiderKycGate: async () => true,
}));

import { prisma } from '@/server/db';
import { POST as setOnline } from '@/app/api/rider/online/route';
import { POST as heartbeat } from '@/app/api/rider/heartbeat/route';
import { POST as location } from '@/app/api/rider/location/route';
import { runHeartbeatSweep } from '@/server/rider-heartbeat';
import { loadFleetSnapshot } from '@/server/live-fleet';
import { computeFleetStats } from '@/lib/live-fleet';
import { approveAllKyc, makeRider } from './rider-fixtures';

const asRider = (userId: string) => (session = { user: { id: userId, role: 'RIDER' } });
const post = (body: unknown) =>
  new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;

async function onlineRider(opts: { test?: boolean } = {}) {
  const { user, profile } = await makeRider({ online: false });
  await approveAllKyc(profile.id);
  if (opts.test) await prisma.user.update({ where: { id: user.id }, data: { isTestAccount: true } });
  asRider(user.id);
  const res = await setOnline(post({ online: true }));
  expect(res.status).toBe(200);
  return { user, profile };
}

/** Pretend the app has been silent for `ms` (heartbeat + last fix moved back). */
async function ageHeartbeat(riderId: string, ms: number) {
  const t = new Date(Date.now() - ms);
  await prisma.riderHeartbeat.update({ where: { riderId }, data: { lastSeenAt: t } });
}

async function snapshotRider(riderId: string) {
  const snap = await loadFleetSnapshot();
  return { snap, rider: snap.riders.find((r) => r.riderId === riderId), waiting: (snap.waiting ?? []).find((w) => w.riderId === riderId) };
}

beforeEach(() => {
  session = null;
});

describe('going online', () => {
  it('stamps lastSeenAt so the sweep cannot flip a rider whose last session was long ago', async () => {
    const { user, profile } = await makeRider({ online: false });
    await approveAllKyc(profile.id);
    // A heartbeat row from yesterday's shift.
    await prisma.riderHeartbeat.create({ data: { riderId: profile.id, lastSeenAt: new Date(Date.now() - 24 * 3600_000) } });
    asRider(user.id);
    expect((await setOnline(post({ online: true }))).status).toBe(200);

    await runHeartbeatSweep(); // the 1-minute cron fires before the app's first heartbeat
    const p = await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(p.isOnline).toBe(true);
  });
});

describe('an online rider is visible on the live map', () => {
  it('appears with a position as soon as the first idle (untagged) fix arrives', async () => {
    const { profile } = await onlineRider();
    const res = await location(post({ lat: 18.5204, lng: 73.8567, recordedAt: Date.now(), sentAt: Date.now() }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50)); // persistence is fire-and-forget

    const { rider, waiting } = await snapshotRider(profile.id);
    expect(waiting).toBeUndefined();
    expect(rider).toMatchObject({ lat: 18.5204, lng: 73.8567, status: 'IDLE', stale: false });
  });

  it('is listed as "waiting for GPS" (not silently dropped) while online with no fix yet', async () => {
    const { user, profile } = await onlineRider();
    asRider(user.id);
    await heartbeat(post({ gpsEnabled: false }));

    const { rider, waiting, snap } = await snapshotRider(profile.id);
    expect(rider).toBeUndefined();
    expect(waiting).toMatchObject({ riderId: profile.id, stale: false, gpsEnabled: false });
    expect((snap.waiting ?? []).some((w) => w.riderId === profile.id)).toBe(true);
  });

  it('shows a pre-launch test rider labelled TEST, kept out of the fleet numbers', async () => {
    const { profile } = await onlineRider({ test: true });
    await location(post({ lat: 18.53, lng: 73.85, recordedAt: Date.now(), sentAt: Date.now() }));
    await new Promise((r) => setTimeout(r, 50));

    const { rider, snap } = await snapshotRider(profile.id);
    expect(rider?.isTest).toBe(true);
    expect(rider?.name).toMatch(/^TEST · /);
    const statsWithout = computeFleetStats(snap.riders.filter((r) => r.riderId !== profile.id), Date.now());
    expect(computeFleetStats(snap.riders, Date.now())).toEqual(statsWithout);
  });
});

describe('staying online with the phone locked (background tracking)', () => {
  it('a background batch of idle fixes refreshes lastSeenAt, so the sweep keeps the rider online and current', async () => {
    const { profile } = await onlineRider();
    await ageHeartbeat(profile.id, 3 * 60_000); // heartbeat timer paused: app in the background
    const now = Date.now();
    // What the background task posts in online mode: untagged fixes ~30 s apart.
    const points = [now - 60_000, now - 30_000, now].map((t, i) => ({ lat: 18.52 + i * 0.001, lng: 73.85, recordedAt: t }));
    const res = await location(post({ points, sentAt: now }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    await runHeartbeatSweep();
    expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } })).isOnline).toBe(true);
    const { rider } = await snapshotRider(profile.id);
    expect(rider).toMatchObject({ lat: 18.522, stale: false });
  });

  it('without background location the sweep sets the rider offline, and the next heartbeat tells the app', async () => {
    const { user, profile } = await onlineRider();
    await ageHeartbeat(profile.id, 3 * 60_000); // app asleep for 3 min, nothing sent
    await runHeartbeatSweep();
    expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } })).isOnline).toBe(false);

    // The app wakes up and heartbeats: it must learn it is offline instead of showing "Online".
    asRider(user.id);
    const res = await heartbeat(post({ gpsEnabled: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ online: false });
    // The heartbeat itself never puts the rider back online.
    expect((await prisma.riderProfile.findUniqueOrThrow({ where: { id: profile.id } })).isOnline).toBe(false);
  });
});
