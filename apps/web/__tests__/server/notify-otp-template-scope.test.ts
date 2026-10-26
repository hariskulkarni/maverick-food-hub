/**
 * F7 — the provider OTP-template path is for OTP messages only. Non-OTP SMS /
 * WhatsApp (SOS, alerts, review asks, digests) must never be rewritten into
 * "<first number> is your code", and must not hit an Authentication template
 * without parameters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTwoFactor } from '@/server/notifications/twofactor';
import { sendMetaWhatsApp } from '@/server/notifications/meta-whatsapp';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ Status: 'Success', Details: 'id1', messages: [{ id: 'w1' }] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const tf = { apiKey: 'k', senderId: 'FLVRLY', templateName: 'OTP1' };

describe('F7: 2Factor', () => {
  it('OTP message (template otp.*) uses the OTP endpoint with meta.otpCode', async () => {
    await sendTwoFactor(tf, { to: '+919876543210', body: 'Your verification code is 123456.', template: 'otp.login', meta: { otpCode: '123456' } });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/SMS/9876543210/123456/OTP1');
  });

  it('SOS SMS with digits goes through the transactional endpoint, verbatim', async () => {
    const body = 'SOS from rider Ravi at 971600, call 9876501234 now';
    await sendTwoFactor(tf, { to: '+919876543210', body, template: 'rider.sos' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/ADDON_SERVICES/SEND/TSMS');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('Msg')).toBe(body);
    // The OTP template must not be attached to a non-OTP message.
    expect(form.get('TemplateName')).toBeNull();
  });

  it('non-OTP SMS uses the configured transactional DLT template', async () => {
    await sendTwoFactor({ ...tf, transactionalTemplateName: 'ALERT1' }, { to: '9876543210', body: 'FSSAI licence expires 2026-11-01', template: 'alert.license.expiry' });
    const form = new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(form.get('TemplateName')).toBe('ALERT1');
  });

  it('untagged message is never treated as an OTP', async () => {
    await sendTwoFactor(tf, { to: '9876543210', body: 'Order 4821 is ready' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/TSMS');
  });
});

const wa = { phoneNumberId: 'p1', accessToken: 't', templateName: 'auth_otp' };

describe('F7: Meta WhatsApp', () => {
  it('OTP message uses the Authentication template with the code', async () => {
    await sendMetaWhatsApp(wa, { to: '+919876543210', body: 'Your verification code is 123456.', template: 'otp.login', meta: { otpCode: '123456' } });
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(payload.type).toBe('template');
    expect(payload.template.components[0].parameters[0].text).toBe('123456');
  });

  it('digest without digits is sent as text, not as a param-less OTP template', async () => {
    await sendMetaWhatsApp(wa, { to: '+919876543210', body: 'Weekly reviews digest: great week!', template: 'reviews.weekly_digest' });
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(payload.type).toBe('text');
    expect(payload.text.body).toBe('Weekly reviews digest: great week!');
  });

  it('alert with digits is not turned into a code', async () => {
    await sendMetaWhatsApp(wa, { to: '+919876543210', body: 'Order 4821 rated 2/5', template: 'reviews.negative_alert' });
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(payload.type).toBe('text');
  });
});
