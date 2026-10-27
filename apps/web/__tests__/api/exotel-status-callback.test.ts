/**
 * POST /api/telephony/exotel/status — authenticity (per-call HMAC token in the
 * URL + optional IP allow-list + CallSid cross-check), JSON and form payloads,
 * idempotency / no downgrade after a terminal status, and no numbers stored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

let rows: Record<string, any>;
const audits: any[] = [];
const sigFailures: any[] = [];

vi.mock('@/server/audit', () => ({ audit: async (action: string, opts: any) => { audits.push({ action, opts }); } }));
vi.mock('@/server/log', () => ({ log: { info() {}, warn() {}, error() {}, debug() {} } }));
vi.mock('@/server/observability/hooks', () => ({
  recordMaskedCall: () => {},
  recordWebhookSignatureFailure: (p: string, r: string) => { sigFailures.push([p, r]); },
}));
vi.mock('@/server/db', () => ({
  prisma: {
    callLog: {
      findUnique: async ({ where }: any) => rows[where.id] ?? null,
      update: async ({ where, data }: any) => Object.assign(rows[where.id], data),
    },
  },
}));

import { POST } from '@/app/api/telephony/exotel/status/route';
import { callbackSignature } from '@/server/telephony/exotel';

const ID = 'clcall1234567';
const CUSTOMER = '+919876543210';

function req(body: unknown, opts: { id?: string; sig?: string | null; form?: boolean; ip?: string } = {}) {
  const id = opts.id ?? ID;
  const sig = opts.sig === undefined ? callbackSignature(id)! : opts.sig;
  const url = `https://flavrly.in/api/telephony/exotel/status?cl=${id}${sig ? `&sig=${sig}` : ''}`;
  const headers: Record<string, string> = { 'x-real-ip': opts.ip ?? '10.0.0.1' };
  let payload: BodyInit;
  if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body as Record<string, string>).toString();
  } else {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return new NextRequest(url, { method: 'POST', headers, body: payload });
}

const terminal = {
  CallSid: 'exo_sid_1',
  EventType: 'terminal',
  Status: 'completed',
  From: '+919811122233',
  To: CUSTOMER,
  StartTime: '2026-10-27 10:00:00',
  EndTime: '2026-10-27 10:02:05',
  ConversationDuration: 110,
  Legs: [{ OnCallDuration: 125, Status: 'completed' }, { OnCallDuration: 110, Status: 'completed' }],
};

beforeEach(() => {
  process.env.EXOTEL_API_TOKEN = 'tok_secret_xyz';
  rows = { [ID]: { id: ID, status: 'IN_PROGRESS', providerCallSid: 'exo_sid_1', provider: 'exotel', orderId: 'o1', assignmentId: 'a1' } };
  audits.length = 0;
  sigFailures.length = 0;
});
afterEach(() => {
  delete process.env.EXOTEL_API_TOKEN;
  delete process.env.EXOTEL_CALLBACK_IP_ALLOWLIST;
});

describe('authenticity', () => {
  it('401s a missing, wrong or cross-call token and applies nothing', async () => {
    expect((await POST(req(terminal, { sig: null }))).status).toBe(401);
    expect((await POST(req(terminal, { sig: 'a'.repeat(64) }))).status).toBe(401);
    // A valid token for a DIFFERENT call can't touch this row.
    const other = callbackSignature('clother123456')!;
    expect((await POST(req(terminal, { sig: other }))).status).toBe(401);
    expect(rows[ID].status).toBe('IN_PROGRESS');
    expect(sigFailures.every(([p]) => p === 'exotel')).toBe(true);
    expect(sigFailures.length).toBe(3);
  });

  it('403s a source IP outside the optional allow-list', async () => {
    process.env.EXOTEL_CALLBACK_IP_ALLOWLIST = '52.1.1.1';
    expect((await POST(req(terminal, { ip: '10.0.0.1' }))).status).toBe(403);
    expect((await POST(req(terminal, { ip: '52.1.1.1' }))).status).toBe(200);
  });

  it('ignores a payload whose CallSid does not match the row', async () => {
    const r = await POST(req({ ...terminal, CallSid: 'someone_else' }));
    expect(r.status).toBe(200);
    expect((await r.json()).applied).toBe(false);
    expect(rows[ID].status).toBe('IN_PROGRESS');
  });
});

describe('applying events', () => {
  it('records the terminal outcome from a JSON callback without storing numbers', async () => {
    const r = await POST(req(terminal));
    expect(r.status).toBe(200);
    expect(rows[ID]).toMatchObject({ status: 'COMPLETED', durationSec: 110, riderLegStatus: 'completed', customerLegStatus: 'completed' });
    expect(rows[ID].endedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(rows)).not.toMatch(/9876543210|9811122233/);
    expect(audits[0]).toMatchObject({ action: 'telephony.call.status', opts: { entityId: 'o1', after: { status: 'COMPLETED' } } });
    expect(JSON.stringify(audits)).not.toMatch(/9876543210/);
  });

  it('accepts the default form-encoded payload (no-answer)', async () => {
    const r = await POST(req({ CallSid: 'exo_sid_1', Status: 'no-answer', DateUpdated: '2026-10-27 10:01:00' }, { form: true }));
    expect(r.status).toBe(200);
    expect(rows[ID].status).toBe('NO_ANSWER');
  });

  it('is idempotent and never downgrades a terminal row', async () => {
    await POST(req(terminal));
    await POST(req(terminal)); // duplicate delivery (Exotel retries)
    expect(audits).toHaveLength(1);
    const late = await POST(req({ CallSid: 'exo_sid_1', EventType: 'answered', Status: 'in-progress' }));
    expect((await late.json()).applied).toBe(false);
    expect(rows[ID].status).toBe('COMPLETED');
  });

  it('answers 200 for an authenticated but unknown call (stops retries)', async () => {
    const id = 'clunknown1234';
    const r = await POST(req(terminal, { id }));
    expect(r.status).toBe(200);
    expect((await r.json()).applied).toBe(false);
  });
});
