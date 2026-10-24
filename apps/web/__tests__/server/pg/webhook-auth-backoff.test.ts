import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { candidateSecrets, parseWebhookBody } from '@/server/pg/webhook-auth';
import { backoffMs } from '@/server/pg/job-lease';

describe('parseWebhookBody', () => {
  it('reads the v2 envelope (fork webhooks-v2, non-legacy endpoints)', () => {
    expect(parseWebhookBody({
      id: 'evt_1', type: 'payment.succeeded',
      data: { object: { id: 'pay_1', orderId: 'ord-1', utr: '4123', amountPaise: 49900, status: 'SUCCESS' } },
    })).toMatchObject({ bodyDeliveryId: 'evt_1', bodyEventType: 'payment.succeeded', gatewayPaymentId: 'pay_1', attemptKey: 'ord-1', utr: '4123', amountPaise: 49900 });
  });

  it('reads the legacy flat body and rejects non-integer/negative amounts', () => {
    expect(parseWebhookBody({ event: 'SUCCESS', paymentId: 'p', orderId: 'o', amountPaise: 10.5 })).toMatchObject({ gatewayPaymentId: 'p', attemptKey: 'o', amountPaise: null, bodyDeliveryId: null });
    expect(parseWebhookBody(null)).toMatchObject({ gatewayPaymentId: null, attemptKey: null });
  });
});

describe('candidateSecrets', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  it('current only, unless a previous secret is inside rotatedAt + 24h', () => {
    expect(candidateSecrets({ webhookSecret: 'a' }, now)).toEqual(['a']);
    expect(candidateSecrets({ webhookSecret: 'a', webhookSecretPrevious: 'b', webhookSecretRotatedAt: '2026-10-23T13:00:00Z' }, now)).toEqual(['a', 'b']);
    expect(candidateSecrets({ webhookSecret: 'a', webhookSecretPrevious: 'b', webhookSecretRotatedAt: '2026-10-23T11:00:00Z' }, now)).toEqual(['a']);
    expect(candidateSecrets({ webhookSecret: 'a', webhookSecretPrevious: 'b' }, now)).toEqual(['a']); // no rotatedAt -> not accepted
    expect(candidateSecrets(null, now)).toEqual([]);
  });
});

describe('backoffMs', () => {
  it('is exponential, jittered within +/-20%, and capped at 1h', () => {
    expect(backoffMs(1, () => 0.5)).toBe(30_000);
    expect(backoffMs(2, () => 0.5)).toBe(60_000);
    expect(backoffMs(1, () => 0)).toBe(24_000);
    expect(backoffMs(1, () => 1)).toBe(36_000);
    expect(backoffMs(50, () => 0.5)).toBe(3_600_000);
  });
});
