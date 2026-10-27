/**
 * Status-event recording on the rider endpoints: one ONLINE/OFFLINE per real
 * transition, SIGNAL_REGAINED once after a sweep-set signal loss, device
 * context stored only for an online rider, and insights failures never break
 * the rider's request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  session: { user: { id: 'u1', role: 'RIDER' } } as any,
  profile: { id: 'r1', isOnline: false },
  events: [] as any[],
  signalLost: false,
  snapshots: [] as any[],
  samples: [] as any[],
  eventsFail: false,
}));

vi.mock('@/server/rider-auth', () => ({ auth: async () => m.session }));
vi.mock('@/server/rider-kyc-gate', () => ({ riderKycGate: async () => ({ canGoOnline: true }) }));
vi.mock('@/server/training/service', () => ({ shiftGateBlockers: async () => [] }));
vi.mock('@/server/db', () => ({
  prisma: {
    user: { findUnique: async () => ({ id: 'u1', createdAt: new Date() }) },
    riderProfile: {
      findUnique: async ({ select }: any) => (select?.isOnline || select?.id ? { ...m.profile } : { ...m.profile }),
      update: async ({ data }: any) => { Object.assign(m.profile, data); return { ...m.profile }; },
    },
    riderHeartbeat: {
      upsert: async () => ({}),
      updateMany: async ({ where }: any) => {
        if (where.signalLostAt && m.signalLost) { m.signalLost = false; return { count: 1 }; }
        return { count: 0 };
      },
    },
    riderStatusEvent: {
      createMany: async ({ data }: any) => {
        if (m.eventsFail) throw new Error('db down');
        m.events.push(...data);
        return { count: data.length };
      },
    },
    riderDeviceSnapshot: {
      findUnique: async () => m.snapshots[m.snapshots.length - 1] ?? null,
      upsert: async ({ create, update }: any) => { m.snapshots.push(m.snapshots.length ? { ...m.snapshots[m.snapshots.length - 1], ...update } : create); return {}; },
    },
    riderDeviceSample: { create: async ({ data }: any) => { m.samples.push(data); return {}; } },
  },
}));

import { POST as setOnline } from '@/app/api/rider/online/route';
import { POST as heartbeat } from '@/app/api/rider/heartbeat/route';

const json = (body: unknown) => ({ json: async () => body, text: async () => JSON.stringify(body) }) as any;

beforeEach(() => {
  m.profile = { id: 'r1', isOnline: false };
  m.events = [];
  m.signalLost = false;
  m.snapshots = [];
  m.samples = [];
  m.eventsFail = false;
});

describe('online toggle events', () => {
  it('records ONLINE then OFFLINE, and nothing when re-asserting the same state', async () => {
    expect((await setOnline(json({ online: true }))).status).toBe(200);
    expect((await setOnline(json({ online: true }))).status).toBe(200);
    expect((await setOnline(json({ online: false }))).status).toBe(200);
    expect((await setOnline(json({ online: false }))).status).toBe(200);
    expect(m.events.map((e) => [e.type, e.source, e.riderId])).toEqual([
      ['ONLINE', 'rider', 'r1'],
      ['OFFLINE', 'rider', 'r1'],
    ]);
  });

  it('a failing events table never fails the toggle', async () => {
    m.eventsFail = true;
    const res = await setOnline(json({ online: true }));
    expect(res.status).toBe(200);
    expect(m.profile.isOnline).toBe(true);
  });
});

describe('heartbeat', () => {
  it('records SIGNAL_REGAINED once after the sweep marked the signal lost', async () => {
    m.profile.isOnline = true;
    m.signalLost = true;
    await heartbeat(json({ gpsEnabled: true }));
    await heartbeat(json({ gpsEnabled: true }));
    expect(m.events.map((e) => [e.type, e.source])).toEqual([['SIGNAL_REGAINED', 'heartbeat']]);
  });

  it('stores device context for an online rider', async () => {
    m.profile.isOnline = true;
    const res = await heartbeat(json({ gpsEnabled: true, device: { model: 'Pixel 8', network: 'CELLULAR', cellGen: '5g', battery: 40, charging: false } }));
    expect(res.status).toBe(200);
    expect(m.snapshots).toHaveLength(1);
    expect(m.snapshots[0]).toMatchObject({ riderId: 'r1', deviceModel: 'Pixel 8', networkType: 'CELLULAR', cellularGeneration: '5g', batteryLevel: 40, charging: false });
    expect(m.samples).toHaveLength(1);
  });

  it('never stores device context for an offline rider', async () => {
    m.profile.isOnline = false;
    const res = await heartbeat(json({ device: { model: 'Pixel 8', battery: 40 } }));
    expect(res.status).toBe(200);
    expect(m.snapshots).toHaveLength(0);
    expect(m.samples).toHaveLength(0);
  });

  it('drops a device object carrying forbidden fields but keeps the heartbeat working', async () => {
    m.profile.isOnline = true;
    const res = await heartbeat(json({ gpsEnabled: true, device: { model: 'X', imei: '356938035643809' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ online: true });
    expect(m.snapshots).toHaveLength(0);
  });
});
