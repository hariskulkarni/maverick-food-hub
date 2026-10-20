import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { redactSecretLinks } from '@/server/notifications';

describe('notification journal redaction', () => {
  it('strips reset tokens for the password-reset template only', () => {
    const body = 'go https://flavrly.in/reset-password?token=abc_DEF-123 now';
    expect(redactSecretLinks('password-reset', body)).not.toContain('abc_DEF-123');
    expect(redactSecretLinks('order-update', body)).toBe(body);
  });
});
