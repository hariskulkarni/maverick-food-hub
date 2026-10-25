import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ upsert: vi.fn(async (_a: unknown) => ({})) }));
vi.mock('@/server/db', () => ({ prisma: { obsErrorLog: { upsert: h.upsert } } }));

import { recordError, fingerprintOf } from '@/server/observability/store';
import { requestStore } from '@/server/observability/request-context';

beforeEach(() => h.upsert.mockClear());

describe('recordError', () => {
  it('redacts message, stack and path, and attaches the request context', async () => {
    await requestStore().run({ requestId: 'req-12345678', method: 'POST', path: '/api/orders/x', route: '/api/orders/[id]', startedAt: 0 }, () =>
      recordError({ source: 'route', message: 'OTP 123456 failed for 9876543210', stack: 'Error\n at f (/a.ts:1:1) Bearer abcdefghijklmnop' }),
    );
    const arg = h.upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(arg.create.message).not.toContain('123456');
    expect(arg.create.message).not.toContain('9876543210');
    expect(String(arg.create.sampleStack)).not.toContain('abcdefghijklmnop');
    expect(arg.create).toMatchObject({ requestId: 'req-12345678', route: '/api/orders/[id]', method: 'POST', kind: 'SERVER' });
  });
  it('groups the same error with different ids under one fingerprint', () => {
    const a = fingerprintOf('ERROR', 'SERVER', '/api/x', 'Order cm1abcdefghijklmnopqrstu missing', 'Error\n at f (/a.ts:1:1)');
    const b = fingerprintOf('ERROR', 'SERVER', '/api/x', 'Order cm9zyxwvutsrqponmlkjihgf missing', 'Error\n at f (/b/a.ts:9:9)');
    expect(a).toBe(b);
    expect(fingerprintOf('ERROR', 'CLIENT', '/api/x', 'Order missing', null)).not.toBe(fingerprintOf('ERROR', 'SERVER', '/api/x', 'Order missing', null));
  });
  it('never throws when the DB fails', async () => {
    h.upsert.mockRejectedValueOnce(new Error('down'));
    await expect(recordError({ source: 's', message: 'm' })).resolves.toBeUndefined();
  });
});
