/**
 * Exotel adapter: config parsing, Calls/connect request building (per the
 * official docs), response/error handling with a mocked fetch, status-callback
 * parsing and the per-call callback token. Plus the phone mask/redact helpers.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  readExotelConfig,
  buildConnectRequest,
  createExotelProvider,
  mapExotelStatus,
  callbackSignature,
  verifyCallbackSignature,
  statusCallbackUrl,
  callbackIpAllowed,
  parseStatusCallback,
  parseExotelTime,
  EXOTEL_DEFAULT_TIME_LIMIT_SEC,
} from '@/server/telephony/exotel';
import { maskPhone, redactPhones, isE164 } from '@/server/telephony/phone';
import { getTelephonyProvider } from '@/server/telephony';

const ENV = {
  EXOTEL_SID: 'flavrly1',
  EXOTEL_API_KEY: 'key_abc',
  EXOTEL_API_TOKEN: 'tok_secret_xyz',
  EXOTEL_SUBDOMAIN: 'api.in.exotel.com',
  EXOTEL_CALLER_ID: '08047112233',
};
const RIDER = '+919811122233';
const CUSTOMER = '+919876543210';

describe('readExotelConfig', () => {
  it('needs every required value', () => {
    expect(readExotelConfig({})).toBeNull();
    for (const k of Object.keys(ENV)) {
      expect(readExotelConfig({ ...ENV, [k]: '' }), k).toBeNull();
    }
    expect(readExotelConfig(ENV)).toMatchObject({ sid: 'flavrly1', subdomain: 'api.in.exotel.com', timeLimitSec: EXOTEL_DEFAULT_TIME_LIMIT_SEC });
    expect(getTelephonyProvider({})).toBeNull();
    expect(getTelephonyProvider(ENV)?.name).toBe('exotel');
  });

  it('only accepts exotel.com hosts (credentials never go elsewhere)', () => {
    expect(readExotelConfig({ ...ENV, EXOTEL_SUBDOMAIN: 'evil.example.com' })).toBeNull();
    expect(readExotelConfig({ ...ENV, EXOTEL_SUBDOMAIN: 'api.exotel.com.evil.io' })).toBeNull();
    expect(readExotelConfig({ ...ENV, EXOTEL_SUBDOMAIN: 'https://api.exotel.com/' })?.subdomain).toBe('api.exotel.com');
  });

  it('clamps the time limit', () => {
    expect(readExotelConfig({ ...ENV, EXOTEL_CALL_TIME_LIMIT_SEC: '240' })?.timeLimitSec).toBe(240);
    expect(readExotelConfig({ ...ENV, EXOTEL_CALL_TIME_LIMIT_SEC: '99999' })?.timeLimitSec).toBe(14400);
    expect(readExotelConfig({ ...ENV, EXOTEL_CALL_TIME_LIMIT_SEC: 'abc' })?.timeLimitSec).toBe(180);
  });
});

describe('buildConnectRequest', () => {
  const cfg = readExotelConfig(ENV)!;

  it('builds the documented Calls/connect request', () => {
    const { url, init } = buildConnectRequest(cfg, { from: RIDER, to: CUSTOMER, statusCallbackUrl: 'https://flavrly.in/cb?x=1', correlationId: 'cl_1' });
    expect(url).toBe('https://api.in.exotel.com/v1/Accounts/flavrly1/Calls/connect');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('key_abc:tok_secret_xyz').toString('base64'));
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init.body);
    expect(form.get('From')).toBe(RIDER);
    expect(form.get('To')).toBe(CUSTOMER);
    expect(form.get('CallerId')).toBe('08047112233');
    expect(form.get('CallType')).toBe('trans');
    expect(form.get('TimeLimit')).toBe('180');
    expect(form.get('CustomField')).toBe('cl_1');
    expect(form.get('StatusCallback')).toBe('https://flavrly.in/cb?x=1');
    expect(form.get('StatusCallbackEvents[0]')).toBe('terminal');
    expect(form.get('StatusCallbackContentType')).toBe('application/json');
    // The secret only ever travels in the Authorization header.
    expect(url).not.toContain('tok_secret_xyz');
    expect(init.body).not.toContain('tok_secret_xyz');
  });

  it('omits the callback fields when there is no callback URL', () => {
    const { init } = buildConnectRequest(cfg, { from: RIDER, to: CUSTOMER, statusCallbackUrl: null });
    const form = new URLSearchParams(init.body);
    expect(form.has('StatusCallback')).toBe(false);
    expect(form.has('StatusCallbackEvents[0]')).toBe(false);
  });
});

describe('createExotelProvider (mocked fetch)', () => {
  const cfg = readExotelConfig(ENV)!;

  it('returns the call SID + mapped status on success', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ Call: { Sid: 'abc123sid', Status: 'in-progress', To: CUSTOMER, From: RIDER } }), { status: 200 }));
    const r = await createExotelProvider(cfg, fetchMock as any).connectCall({ from: RIDER, to: CUSTOMER });
    expect(r).toEqual({ ok: true, providerCallSid: 'abc123sid', status: 'IN_PROGRESS' });
    expect(JSON.stringify(r)).not.toContain('9876543210');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('redacts numbers echoed in a provider error', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ RestException: { Status: 400, Message: `Invalid To number ${CUSTOMER}` } }), { status: 400 }));
    const r = await createExotelProvider(cfg, fetchMock as any).connectCall({ from: RIDER, to: CUSTOMER });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.httpStatus).toBe(400);
      expect(r.reason).toContain('exotel_http_400');
      expect(r.reason).not.toMatch(/\d{5,}/);
    }
  });

  it('maps network failures and malformed bodies without throwing', async () => {
    const boom = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await createExotelProvider(cfg, boom as any).connectCall({ from: RIDER, to: CUSTOMER })).toEqual({ ok: false, httpStatus: 0, reason: 'exotel_network_error' });
    const odd = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await createExotelProvider(cfg, odd as any).connectCall({ from: RIDER, to: CUSTOMER })).toMatchObject({ ok: false, reason: 'exotel_unexpected_response' });
  });
});

describe('status mapping + callback payload', () => {
  it('maps every documented call / leg status', () => {
    expect(mapExotelStatus('queued')).toBe('QUEUED');
    expect(mapExotelStatus('in-progress')).toBe('IN_PROGRESS');
    expect(mapExotelStatus('completed')).toBe('COMPLETED');
    expect(mapExotelStatus('busy')).toBe('BUSY');
    expect(mapExotelStatus('no-answer')).toBe('NO_ANSWER');
    expect(mapExotelStatus('failed')).toBe('FAILED');
    expect(mapExotelStatus('canceled')).toBe('CANCELED');
    expect(mapExotelStatus('weird')).toBeNull();
  });

  it('parses the documented terminal payload and drops numbers', () => {
    const ev = parseStatusCallback({
      CallSid: '80bfbec2d78bbbf10fb851f4fa165211',
      EventType: 'terminal',
      Status: 'completed',
      From: RIDER,
      To: CUSTOMER,
      StartTime: '2026-10-27 10:00:00',
      EndTime: '2026-10-27 10:05:35',
      ConversationDuration: 320,
      Legs: [{ OnCallDuration: 335, Status: 'completed' }, { OnCallDuration: 320, Status: 'completed' }],
    });
    expect(ev).toMatchObject({ callSid: '80bfbec2d78bbbf10fb851f4fa165211', status: 'COMPLETED', eventType: 'terminal', durationSec: 320, riderLegStatus: 'completed', customerLegStatus: 'completed' });
    expect(ev.startedAt?.toISOString()).toBe('2026-10-27T04:30:00.000Z'); // IST → UTC
    expect(JSON.stringify(ev)).not.toContain('9876543210');
    expect(parseExotelTime('nope')).toBeNull();
  });
});

describe('callback authenticity helpers', () => {
  it('signs per call and verifies in constant time', () => {
    const sig = callbackSignature('clabc123456', ENV)!;
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCallbackSignature('clabc123456', sig, ENV)).toBe(true);
    expect(verifyCallbackSignature('clother12345', sig, ENV)).toBe(false);
    expect(verifyCallbackSignature('clabc123456', 'f'.repeat(64), ENV)).toBe(false);
    expect(verifyCallbackSignature('clabc123456', null, ENV)).toBe(false);
    expect(verifyCallbackSignature('clabc123456', sig, {})).toBe(false);
    // The token is not the API token itself.
    expect(sig).not.toContain('tok_secret_xyz');
  });

  it('builds the callback URL from NEXTAUTH_URL (or an override)', () => {
    const url = statusCallbackUrl('clabc123456', { ...ENV, NEXTAUTH_URL: 'https://flavrly.in/' })!;
    expect(url.startsWith('https://flavrly.in/api/telephony/exotel/status?cl=clabc123456&sig=')).toBe(true);
    expect(statusCallbackUrl('clabc123456', { ...ENV, NEXTAUTH_URL: 'https://a.in', EXOTEL_STATUS_CALLBACK_BASE_URL: 'https://b.in' })).toContain('https://b.in/');
    expect(statusCallbackUrl('clabc123456', ENV)).toBeNull();
  });

  it('enforces the optional IP allow-list', () => {
    expect(callbackIpAllowed('1.2.3.4', {})).toBe(true);
    expect(callbackIpAllowed('1.2.3.4', { EXOTEL_CALLBACK_IP_ALLOWLIST: '5.6.7.8, 1.2.3.4' })).toBe(true);
    expect(callbackIpAllowed('9.9.9.9', { EXOTEL_CALLBACK_IP_ALLOWLIST: '5.6.7.8' })).toBe(false);
    expect(callbackIpAllowed(null, { EXOTEL_CALLBACK_IP_ALLOWLIST: '5.6.7.8' })).toBe(false);
  });
});

describe('phone helpers', () => {
  it('masks to "+91 ******12"', () => {
    expect(maskPhone('+919876543212')).toBe('+91 ******12');
    expect(maskPhone('9876543212')).toBe('******12');
    expect(maskPhone('+14155550123')).toBe('******23');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('12')).toBeNull();
  });

  it('redacts digit runs that could be numbers', () => {
    expect(redactPhones('call +91 98765 43210 failed')).toBe('call [redacted] failed');
    expect(redactPhones('http 400 error')).toBe('http 400 error');
  });

  it('accepts E.164 only', () => {
    expect(isE164('+919876543210')).toBe(true);
    expect(isE164('9876543210')).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});
