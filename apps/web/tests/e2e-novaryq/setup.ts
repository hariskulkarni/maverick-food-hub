/**
 * Per-file setup for the Novaryq E2E suite: test env + side-effect stubs. Only notification
 * delivery, realtime fan-out and rider push are stubbed (recorded, so alerts can be asserted).
 */
import { vi } from 'vitest';

process.env.INTEGRATION_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString('base64'); // fake test key
process.env.NOVARYQ_INTEGRATION_ENABLED = 'true';
process.env.NOVARYQ_ALLOW_INSECURE_BASE_URL = 'true'; // the simulator is http://127.0.0.1 (never honoured in production)
process.env.INTERNAL_CRON_SECRET = 'qa-internal-cron-secret';
delete process.env.REDIS_URL;

// Shared with the test files through ./sent (a global, because vi.mock factories are hoisted).
const sent = vi.hoisted(() => {
  const g = globalThis as any;
  g.__novaryqQaSent ??= { notify: [], alerts: [] };
  return g.__novaryqQaSent as { notify: { channel: string; args: any }[]; alerts: { fn: string; args: any[] }[] };
});

vi.mock('@/server/realtime', async (orig) => ({ ...(await orig<Record<string, unknown>>()), publish: vi.fn() }));
vi.mock('@/server/notifications', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  notify: {
    sms: vi.fn(async (args: any) => { sent.notify.push({ channel: 'SMS', args }); return { ok: true } as any; }),
    whatsapp: vi.fn(async (args: any) => { sent.notify.push({ channel: 'WHATSAPP', args }); return { ok: true } as any; }),
    email: vi.fn(async (args: any) => { sent.notify.push({ channel: 'EMAIL', args }); return { ok: true } as any; }),
  },
}));
vi.mock('@/server/alerts', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = { ...real };
  for (const [k, v] of Object.entries(real)) {
    if (typeof v === 'function' && /^send/.test(k)) {
      wrapped[k] = vi.fn(async (...args: any[]) => { sent.alerts.push({ fn: k, args }); return { sent: true, recipients: ['qa@test.invalid'] }; });
    }
  }
  return wrapped;
});
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));
vi.mock('@/server/operating-hours', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isBranchOpenAt: () => ({ isOpen: true, label: 'Open' }),
  isScheduledTimeInsideOpenWindow: () => true,
}));
vi.mock('@/server/payments/online', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  startOnlinePayment: vi.fn(async () => ({ providerName: 'razorpay', redirectUrl: 'https://pay.example.test/x' })),
}));
