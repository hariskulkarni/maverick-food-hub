/**
 * H23 — verifyWidgetAccessToken must take the phone ONLY from MSG91's verified
 * response, never the client-supplied claimedPhone or the unsigned token payload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyWidgetAccessToken } from '@/server/msg91-widget';

function mockFetch(body: object, status = 200) {
  (globalThis as any).fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => { vi.stubEnv('MSG91_AUTH_KEY', 'test-authkey'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('H23: msg91-widget phone trust', () => {
  it('ok:false when no authkey or empty token', async () => {
    vi.stubEnv('MSG91_AUTH_KEY', '');
    expect(await verifyWidgetAccessToken('tok')).toEqual({ ok: false, phone: null });
  });

  it('returns the phone from the verified response (no claimedPhone)', async () => {
    mockFetch({ type: 'success', mobile: '919000000001' });
    expect(await verifyWidgetAccessToken('tok')).toEqual({ ok: true, phone: '+919000000001' });
  });

  it('REJECTS a claimedPhone that differs from the verified phone (takeover attempt)', async () => {
    mockFetch({ type: 'success', mobile: '919000000001' }); // attacker's verified number
    const r = await verifyWidgetAccessToken('tok', '+919999999999'); // victim's number claimed
    expect(r).toEqual({ ok: false, phone: null });
  });

  it('accepts a matching claimedPhone', async () => {
    mockFetch({ type: 'success', mobile: '919000000001' });
    expect(await verifyWidgetAccessToken('tok', '9000000001')).toEqual({ ok: true, phone: '+919000000001' });
  });

  it('ok:false when the verified response carries no phone', async () => {
    mockFetch({ type: 'success', message: 'OTP verified successfully' });
    expect(await verifyWidgetAccessToken('tok', '+919999999999')).toEqual({ ok: false, phone: null });
  });

  it('ok:false when MSG91 does not return success', async () => {
    mockFetch({ type: 'error', message: 'bad token' }, 400);
    expect(await verifyWidgetAccessToken('tok')).toEqual({ ok: false, phone: null });
  });
});
