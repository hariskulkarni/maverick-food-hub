/** Defect 10 — the public /contact form creates a support ticket, validated + rate-limited. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: any[] = [];
let limited = false;
vi.mock('@/server/auth', () => ({ auth: async () => null }));
vi.mock('@/server/http/rate-limit', () => ({
  rateLimit: async () => (limited ? { ok: false, response: new Response('slow down', { status: 429 }), retryAfterSec: 60 } : { ok: true, remaining: 1 })
}));
vi.mock('@/server/db', () => ({
  prisma: { supportTicket: { create: async ({ data }: any) => { created.push(data); return { id: 't1' }; } } }
}));

import { POST } from '@/app/api/support/contact/route';

const req = (body: unknown) => ({ json: async () => body }) as any;
const good = { name: 'Asha', email: 'Asha@Example.com', topic: 'refund', message: 'My refund has not arrived yet.' };

beforeEach(() => { created.length = 0; limited = false; });

describe('POST /api/support/contact', () => {
  it('creates a support ticket carrying the contact details', async () => {
    const r = await POST(req(good));
    expect(r.status).toBe(201);
    expect(created[0].type).toBe('REFUND_REQUEST');
    expect(created[0].message).toContain('Asha <asha@example.com>');
    expect(created[0].message).toContain('My refund has not arrived yet.');
  });
  it('validates input', async () => {
    expect((await POST(req({ ...good, email: 'nope' }))).status).toBe(400);
    expect((await POST(req({ ...good, message: 'short' }))).status).toBe(400);
    expect((await POST(req({ ...good, topic: 'hack' }))).status).toBe(400);
    expect(created).toHaveLength(0);
  });
  it('drops honeypot submissions silently', async () => {
    expect((await POST(req({ ...good, website: 'http://spam' }))).status).toBe(201);
    expect(created).toHaveLength(0);
  });
  it('is rate limited', async () => {
    limited = true;
    expect((await POST(req(good))).status).toBe(429);
    expect(created).toHaveLength(0);
  });
});
