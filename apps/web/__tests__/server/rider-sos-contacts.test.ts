import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const sms = vi.fn();
vi.mock('@/server/db', () => ({ prisma: { sosAlert: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock('@/server/notifications', () => ({ notify: { sms: (...a: unknown[]) => sms(...a) } }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendSosToEmergencyContacts, formatSosSms } from '@/server/notify-templates';

const alertRow = (over: Record<string, unknown> = {}) => ({
  id: 'sos1',
  lat: 12.9716,
  lng: 77.5946,
  triggeredAt: new Date('2026-10-24T09:30:00Z'),
  rider: {
    userId: 'u1',
    user: { name: 'Ravi Kumar', phone: '+919000000001' },
    emergencyContacts: [{ phone: '+919111111111' }, { phone: '+919222222222' }],
    preferences: { emergencyPhone: '+919111111111' }
  },
  ...over
});

describe('sendSosToEmergencyContacts', () => {
  beforeEach(() => {
    findUnique.mockReset();
    sms.mockReset();
    sms.mockResolvedValue({ ok: true });
  });

  it('texts every configured contact once with rider name, time and map link', async () => {
    findUnique.mockResolvedValue(alertRow());
    const r = await sendSosToEmergencyContacts('sos1');
    expect(r.sent).toBe(2);
    expect(sms.mock.calls.map((c) => c[0].to)).toEqual(['+919111111111', '+919222222222']);
    const body = sms.mock.calls[0][0].body as string;
    expect(body).toContain('Ravi Kumar');
    expect(body).toContain('03:00 pm IST');
    expect(body).toContain('https://maps.google.com/?q=12.971600,77.594600');
  });

  it('is a no-op without contacts and never throws on errors', async () => {
    findUnique.mockResolvedValue(alertRow({ rider: { userId: 'u1', user: { name: 'R', phone: null }, emergencyContacts: [], preferences: null } }));
    expect((await sendSosToEmergencyContacts('sos1')).sent).toBe(0);
    expect(sms).not.toHaveBeenCalled();
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(sendSosToEmergencyContacts('sos1')).resolves.toEqual({ sent: 0 });
  });

  it('says location is unavailable when no coordinates were sent', () => {
    expect(formatSosSms({ riderName: 'R', at: new Date(), lat: null, lng: null })).toContain('Location not available');
  });
});
