/**
 * POST /api/rider/assignments/[id]/call-customer — masked calling via Exotel.
 * Auth, ownership, state checks, test-account refusal, 503 when unconfigured,
 * per-assignment rate limit, the exact Exotel request (mocked fetch), and that
 * no phone number ever appears in a response, a log line or an audit row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RIDER_PHONE = '+919811122233';
const CUSTOMER_PHONE = '+919876543210';
const DIGITS = /9811122233|9876543210/;

let session: any;
let profile: any;
let assignment: any;
let callLogs: any[];
const audits: any[] = [];
const logLines: any[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

vi.mock('@/server/rider-auth', () => ({ auth: async () => session }));
vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { audits.push({ action, opts }); } }));
vi.mock('@/server/log', () => {
  const rec = (level: string) => (...args: any[]) => { logLines.push({ level, args }); };
  return { log: { info: rec('info'), warn: rec('warn'), error: rec('error'), debug: rec('debug') } };
});
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async ({ where }: any) => (where.userId === session?.user.id ? profile : null) },
    riderAssignment: { findUnique: async ({ where }: any) => (assignment && where.id === assignment.id ? assignment : null) },
    callLog: {
      findMany: async ({ where }: any) =>
        callLogs
          .filter((c) => c.assignmentId === where.assignmentId && c.createdAt >= where.createdAt.gte)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((c) => ({ createdAt: c.createdAt })),
      create: async ({ data }: any) => {
        const row = { id: `cl${callLogs.length + 1}abcdefgh`, status: 'REQUESTED', createdAt: new Date(), ...data };
        callLogs.push(row);
        return { id: row.id };
      },
      update: async ({ where, data }: any) => {
        const row = callLogs.find((c) => c.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
  },
}));

import { POST } from '@/app/api/rider/assignments/[id]/call-customer/route';

const call = (id = 'a1') => POST({ headers: new Headers() } as any, { params: Promise.resolve({ id }) });

const ENV_KEYS = ['EXOTEL_SID', 'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN', 'EXOTEL_SUBDOMAIN', 'EXOTEL_CALLER_ID', 'NEXTAUTH_URL'];
function configure() {
  process.env.EXOTEL_SID = 'flavrly1';
  process.env.EXOTEL_API_KEY = 'key_abc';
  process.env.EXOTEL_API_TOKEN = 'tok_secret_xyz';
  process.env.EXOTEL_SUBDOMAIN = 'api.in.exotel.com';
  process.env.EXOTEL_CALLER_ID = '08047112233';
  process.env.NEXTAUTH_URL = 'https://flavrly.in';
}

beforeEach(() => {
  session = { user: { id: 'u1', role: 'RIDER' } };
  profile = { id: 'rp1', user: { phone: RIDER_PHONE, isTestAccount: false } };
  assignment = {
    id: 'a1',
    riderId: 'rp1',
    status: 'PICKED_UP',
    orderId: 'o1',
    order: { id: 'o1', status: 'RIDER_REACHED_CUSTOMER', customer: { phone: CUSTOMER_PHONE, isTestAccount: false } },
  };
  callLogs = [];
  audits.length = 0;
  logLines.length = 0;
  configure();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ Call: { Sid: 'exo_sid_1', Status: 'in-progress', To: CUSTOMER_PHONE, From: RIDER_PHONE } }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('auth + ownership + state', () => {
  it('403s non-riders and missing sessions', async () => {
    session = { user: { id: 'u1', role: 'CUSTOMER' } };
    expect((await call()).status).toBe(403);
    session = null;
    expect((await call()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s another rider's assignment and unknown ids", async () => {
    assignment.riderId = 'rp-other';
    expect((await call()).status).toBe(404);
    expect((await call('nope')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('409s when the assignment is not active or the order is closed', async () => {
    for (const status of ['PENDING', 'DELIVERED', 'CANCELLED', 'REJECTED']) {
      assignment.status = status;
      const r = await call();
      expect(r.status, status).toBe(409);
      expect((await r.json()).error).toBe('not_active');
    }
    assignment.status = 'ACCEPTED';
    assignment.order.status = 'CANCELLED_BY_CUSTOMER';
    expect((await call()).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows ACCEPTED, PICKED_UP and the customer-unreachable hold', async () => {
    assignment.status = 'ACCEPTED';
    assignment.order.status = 'PREPARING';
    expect((await call()).status).toBe(200);
    assignment.status = 'PICKED_UP';
    assignment.order.status = 'CUSTOMER_UNREACHABLE';
    expect((await call()).status).toBe(200);
  });
});

describe('refusals that must never place a real call', () => {
  it('refuses test riders and test customers', async () => {
    profile.user.isTestAccount = true;
    let r = await call();
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('test_account');
    profile.user.isTestAccount = false;
    assignment.order.customer.isTestAccount = true;
    r = await call();
    expect(r.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callLogs).toHaveLength(0);
  });

  it('503s with a clear fallback message when Exotel is not configured', async () => {
    delete process.env.EXOTEL_API_TOKEN;
    const r = await call();
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error).toBe('telephony_unavailable');
    expect(body.message).toMatch(/Customer unreachable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('422s when the customer has no dialable number', async () => {
    assignment.order.customer.phone = null;
    const r = await call();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('customer_phone_missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('placing the call', () => {
  it('asks Exotel to connect rider → customer via the ExoPhone and returns no numbers', async () => {
    const r = await call();
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: true, callId: callLogs[0].id, message: 'Calling you now — pick up to be connected' });
    expect(text).not.toMatch(DIGITS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.in.exotel.com/v1/Accounts/flavrly1/Calls/connect');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('From')).toBe(RIDER_PHONE);
    expect(form.get('To')).toBe(CUSTOMER_PHONE);
    expect(form.get('CallerId')).toBe('08047112233');
    expect(form.get('TimeLimit')).toBe('180');
    expect(form.get('StatusCallback')).toMatch(new RegExp(`^https://flavrly\\.in/api/telephony/exotel/status\\?cl=${callLogs[0].id}&sig=[0-9a-f]{64}$`));

    expect(callLogs[0]).toMatchObject({ provider: 'exotel', assignmentId: 'a1', orderId: 'o1', riderId: 'rp1', providerCallSid: 'exo_sid_1', status: 'IN_PROGRESS' });
    expect(JSON.stringify(callLogs)).not.toMatch(DIGITS);
    expect(audits[0]).toMatchObject({ action: 'telephony.call.request', opts: { entityType: 'Order', entityId: 'o1' } });
    expect(JSON.stringify(audits)).not.toMatch(DIGITS);
    expect(JSON.stringify(logLines)).not.toMatch(DIGITS);
  });

  it('502s on a provider error, stores a redacted reason and logs no numbers', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ RestException: { Status: 400, Message: `Bad To ${CUSTOMER_PHONE}` } }), { status: 400 }));
    const r = await call();
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(JSON.parse(text).error).toBe('call_failed');
    expect(text).not.toMatch(DIGITS);
    expect(callLogs[0].status).toBe('FAILED');
    expect(callLogs[0].failureReason).toContain('exotel_http_400');
    expect(JSON.stringify(callLogs)).not.toMatch(DIGITS);
    expect(logLines.some((l) => l.level === 'warn')).toBe(true);
    expect(JSON.stringify(logLines)).not.toMatch(DIGITS);
    expect(JSON.stringify(audits)).not.toMatch(DIGITS);
  });
});

describe('rate limit', () => {
  it('allows 3 calls per assignment per 10 minutes, then 429 with Retry-After', async () => {
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    const r = await call();
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await r.json()).error).toBe('rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('frees up once the oldest call leaves the window', async () => {
    const old = new Date(Date.now() - 11 * 60_000);
    callLogs.push(
      { id: 'clold1aaaaaaa', assignmentId: 'a1', createdAt: old },
      { id: 'clold2aaaaaaa', assignmentId: 'a1', createdAt: old },
      { id: 'clold3aaaaaaa', assignmentId: 'a1', createdAt: old }
    );
    expect((await call()).status).toBe(200);
  });

  it('counts per assignment, not across assignments', async () => {
    const now = new Date();
    callLogs.push(
      { id: 'clx1aaaaaaaaa', assignmentId: 'a-other', createdAt: now },
      { id: 'clx2aaaaaaaaa', assignmentId: 'a-other', createdAt: now },
      { id: 'clx3aaaaaaaaa', assignmentId: 'a-other', createdAt: now }
    );
    expect((await call()).status).toBe(200);
  });
});
