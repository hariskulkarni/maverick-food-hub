import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
  prisma: {
    webPushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn()
    }
  }
}));

vi.mock('@/server/auth', () => ({ auth: h.auth }));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('web-push', () => ({
  default: { sendNotification: h.sendNotification, setVapidDetails: h.setVapidDetails }
}));

import { sendWebPush } from '@/server/push/webpush';
import { POST as subscribe } from '@/app/api/push/subscribe/route';
import { POST as unsubscribe } from '@/app/api/push/unsubscribe/route';
import { GET as vapidKey } from '@/app/api/push/vapid-public-key/route';

const req = (body: unknown) =>
  new Request('http://x/api/push', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'UA' } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:a@b.c';
  h.auth.mockResolvedValue({ user: { id: 'u1' } });
});

describe('subscribe', () => {
  it('upserts by endpoint for the session user', async () => {
    const res = await subscribe(req({ endpoint: 'https://e/1', keys: { p256dh: 'P', auth: 'A' } }));
    expect(res.status).toBe(200);
    const arg = h.prisma.webPushSubscription.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ endpoint: 'https://e/1' });
    expect(arg.create).toMatchObject({ userId: 'u1', endpoint: 'https://e/1', p256dh: 'P', auth: 'A' });
    expect(arg.update).toMatchObject({ userId: 'u1', p256dh: 'P', auth: 'A' });
  });
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect((await subscribe(req({}))).status).toBe(401);
    expect(h.prisma.webPushSubscription.upsert).not.toHaveBeenCalled();
  });
  it('400 on invalid body', async () => {
    expect((await subscribe(req({ endpoint: 'x' }))).status).toBe(400);
  });
});

describe('unsubscribe', () => {
  it('deletes the endpoint scoped to the session user', async () => {
    const res = await unsubscribe(req({ endpoint: 'https://e/1' }));
    expect(res.status).toBe(200);
    expect(h.prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://e/1', userId: 'u1' }
    });
  });
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect((await unsubscribe(req({ endpoint: 'x' }))).status).toBe(401);
  });
});

describe('vapid-public-key', () => {
  it('returns the key for authed user', async () => {
    const res = await vapidKey();
    expect(await res.json()).toEqual({ publicKey: 'pub' });
  });
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null);
    expect((await vapidKey()).status).toBe(401);
  });
});

describe('sendWebPush', () => {
  const subs = [
    { id: 's1', endpoint: 'https://e/1', p256dh: 'P1', auth: 'A1' },
    { id: 's2', endpoint: 'https://e/2', p256dh: 'P2', auth: 'A2' }
  ];
  it('fans out to all subscriptions with VAPID', async () => {
    h.prisma.webPushSubscription.findMany.mockResolvedValue(subs);
    h.sendNotification.mockResolvedValue({});
    await sendWebPush('u1', { title: 'T', body: 'B', url: '/x' });
    expect(h.prisma.webPushSubscription.findMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(h.setVapidDetails).toHaveBeenCalledWith('mailto:a@b.c', 'pub', 'priv');
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    expect(h.sendNotification.mock.calls[0][0]).toEqual({ endpoint: 'https://e/1', keys: { p256dh: 'P1', auth: 'A1' } });
    expect(JSON.parse(h.sendNotification.mock.calls[0][1])).toMatchObject({ title: 'T', body: 'B', url: '/x' });
    expect(h.prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
  });
  it.each([404, 410])('prunes endpoints returning %i and keeps going', async (code) => {
    h.prisma.webPushSubscription.findMany.mockResolvedValue(subs);
    h.sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: code }))
      .mockResolvedValueOnce({});
    await sendWebPush('u1', { title: 'T', body: 'B' });
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
    expect(h.prisma.webPushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: { in: ['https://e/1'] } }
    });
  });
  it('does not prune or throw on other errors', async () => {
    h.prisma.webPushSubscription.findMany.mockResolvedValue(subs);
    h.sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    await expect(sendWebPush('u1', { title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(h.prisma.webPushSubscription.deleteMany).not.toHaveBeenCalled();
  });
  it('no-ops with no subscriptions', async () => {
    h.prisma.webPushSubscription.findMany.mockResolvedValue([]);
    await sendWebPush('u1', { title: 'T', body: 'B' });
    expect(h.sendNotification).not.toHaveBeenCalled();
  });
});
