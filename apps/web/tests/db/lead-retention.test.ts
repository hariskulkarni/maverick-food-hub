import { afterAll, describe, expect, it } from 'vitest';
import { prisma, uid } from './fixtures';
import { redactOldWebhookPayloads } from '@/server/pg/inbox';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('webhook payload retention (real DB)', () => {
  it('redacts old processed youpi payloads only; keeps fresh, unprocessed and other providers', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    const mk = (provider: string, processed: boolean, createdAt: Date) =>
      prisma.paymentWebhookEvent.create({
        data: { provider, eventType: 'SUCCESS', providerEventId: `${provider}:${uid()}`, rawPayload: { utr: 'U1', payer: 'x' }, processed, createdAt },
      });
    const a = await mk('youpi', true, old);
    const b = await mk('youpi', false, old);
    const c = await mk('youpi', true, new Date());
    const d = await mk('razorpay', true, old);
    const r = await redactOldWebhookPayloads();
    expect(r.redacted).toBeGreaterThanOrEqual(1);
    const get = async (id: string) => (await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id } })).rawPayload as Record<string, unknown>;
    expect((await get(a.id)).redacted).toBe(true);
    expect((await get(b.id)).utr).toBe('U1');
    expect((await get(c.id)).utr).toBe('U1');
    expect((await get(d.id)).utr).toBe('U1');
    expect((await redactOldWebhookPayloads()).redacted).toBe(0); // idempotent
  });
});
