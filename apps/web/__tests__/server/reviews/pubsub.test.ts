import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { generateKeyPairSync, createSign, type KeyObject } from 'node:crypto';

const h = vi.hoisted(() => ({ findMany: vi.fn(), getConfig: vi.fn(), sweep: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { integrationCredential: { findMany: h.findMany } } }));
vi.mock('@/server/integrations', () => ({ getConfig: h.getConfig }));
vi.mock('@/server/jobs/google-reviews-sweep', () => ({ runGoogleReviewsSweep: h.sweep }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { verifyPushToken, parseNotification, restaurantForLocation, _resetCertCache, GOOGLE_CERTS_URL } from '@/server/reviews/pubsub';
import { POST } from '@/app/api/webhooks/google-business/route';

const AUD = 'https://flavrly.in/api/webhooks/google-business';
const SA = 'gbp-push@flavrly.iam.gserviceaccount.com';
const cfg = { audience: AUD, serviceAccount: SA };
let priv: KeyObject; let jwk: any; let otherPriv: KeyObject;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims: Record<string, unknown>, key = priv, kid = 'k1', alg = 'RS256') {
  const h = b64({ alg, kid, typ: 'JWT' });
  const p = b64(claims);
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url');
  return `Bearer ${h}.${p}.${s}`;
}
const now = Math.floor(Date.now() / 1000);
const good = () => ({ iss: 'https://accounts.google.com', aud: AUD, exp: now + 600, iat: now, email: SA, email_verified: true });

beforeAll(() => {
  const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
  priv = kp.privateKey;
  jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  otherPriv = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
});

beforeEach(() => {
  vi.clearAllMocks(); vi.restoreAllMocks();
  _resetCertCache();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url) === GOOGLE_CERTS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    throw new Error('unexpected fetch');
  });
});

describe('verifyPushToken', () => {
  it('accepts a valid Google-signed token for our audience and service account', async () => {
    expect(await verifyPushToken(sign(good()), cfg)).toBe(true);
  });
  it.each([
    ['wrong audience', { aud: 'https://evil.example' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: now - 3600 }],
    ['issued in the future', { iat: now + 3600 }],
    ['other service account', { email: 'someone@else.iam.gserviceaccount.com' }],
    ['unverified email', { email_verified: false }],
  ])('rejects %s', async (_n, override) => {
    expect(await verifyPushToken(sign({ ...good(), ...override }), cfg)).toBe(false);
  });
  it('rejects a token signed by a different key, an unknown kid, alg none and garbage', async () => {
    expect(await verifyPushToken(sign(good(), otherPriv), cfg)).toBe(false);
    expect(await verifyPushToken(sign(good(), priv, 'unknown'), cfg)).toBe(false);
    const none = `Bearer ${b64({ alg: 'none', kid: 'k1' })}.${b64(good())}.x`;
    expect(await verifyPushToken(none, cfg)).toBe(false);
    expect(await verifyPushToken('Bearer nope', cfg)).toBe(false);
    expect(await verifyPushToken(null, cfg)).toBe(false);
  });
  it('rejects a tampered payload', async () => {
    const [hd, , sg] = sign(good()).slice(7).split('.');
    const forged = `Bearer ${hd}.${b64({ ...good(), email: 'x@y' })}.${sg}`;
    expect(await verifyPushToken(forged, cfg)).toBe(false);
  });
});

describe('parseNotification + restaurantForLocation', () => {
  const msg = (o: unknown) => ({ message: { data: Buffer.from(JSON.stringify(o)).toString('base64') } });
  it('parses GBP notifications', () => {
    expect(parseNotification(msg({ type: 'NEW_REVIEW', location: 'accounts/1/locations/2', review: 'accounts/1/locations/2/reviews/3' })))
      .toEqual({ type: 'NEW_REVIEW', location: 'accounts/1/locations/2', review: 'accounts/1/locations/2/reviews/3' });
    expect(parseNotification({})).toBeNull();
    expect(parseNotification({ message: { data: 'not-json' } })).toBeNull();
  });
  it('finds the connected restaurant whose selected location matches', async () => {
    h.findMany.mockResolvedValue([{ restaurantId: 'r1' }, { restaurantId: 'r2' }]);
    h.getConfig.mockImplementation(async (id: string) => ({ locationId: id === 'r2' ? 'locations/2' : 'locations/9' }));
    expect(await restaurantForLocation('accounts/1/locations/2')).toBe('r2');
    expect(await restaurantForLocation('accounts/1/locations/77')).toBeNull();
  });
});

describe('POST /api/webhooks/google-business', () => {
  const req = (auth: string | null, body: unknown) => new Request('https://flavrly.in/api/webhooks/google-business', {
    method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body),
  }) as any;
  const body = { message: { data: Buffer.from(JSON.stringify({ type: 'NEW_REVIEW', location: 'accounts/1/locations/2' })).toString('base64') } };

  it('404 when not configured (polling remains)', async () => {
    delete process.env.GBP_PUBSUB_AUDIENCE; delete process.env.GBP_PUBSUB_SERVICE_ACCOUNT;
    expect((await POST(req(sign(good()), body))).status).toBe(404);
  });
  it('401 on an invalid token, no sync', async () => {
    process.env.GBP_PUBSUB_AUDIENCE = AUD; process.env.GBP_PUBSUB_SERVICE_ACCOUNT = SA;
    expect((await POST(req(sign(good(), otherPriv), body))).status).toBe(401);
    expect(h.sweep).not.toHaveBeenCalled();
  });
  it('204 and a targeted sync for a verified push', async () => {
    process.env.GBP_PUBSUB_AUDIENCE = AUD; process.env.GBP_PUBSUB_SERVICE_ACCOUNT = SA;
    h.findMany.mockResolvedValue([{ restaurantId: 'r2' }]);
    h.getConfig.mockResolvedValue({ locationId: 'locations/2' });
    h.sweep.mockResolvedValue({ newReviews: 1 });
    const res = await POST(req(sign(good()), body));
    expect(res.status).toBe(204);
    expect(h.sweep).toHaveBeenCalledWith({ restaurantIds: ['r2'] });
  });
  it('204 ack without sync for an unknown location', async () => {
    process.env.GBP_PUBSUB_AUDIENCE = AUD; process.env.GBP_PUBSUB_SERVICE_ACCOUNT = SA;
    h.findMany.mockResolvedValue([]);
    expect((await POST(req(sign(good()), body))).status).toBe(204);
    expect(h.sweep).not.toHaveBeenCalled();
  });
});
