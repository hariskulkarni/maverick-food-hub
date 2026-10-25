/**
 * Lead sweep (a): the system-health "Deployment" card must show the settings
 * delivery actually reads (NOTIFIER_SMS / NOTIFIER_EMAIL / NOTIFIER_WHATSAPP,
 * STORAGE_DRIVER) — not dead ENABLE_* flags or a hardcoded 'msg91' default.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { deploymentSummary } from '@/server/feature-flags';

afterEach(() => { vi.unstubAllEnvs(); });

describe('deploymentSummary', () => {
  it('reports the real notifier + storage settings', () => {
    vi.stubEnv('NOTIFIER_SMS', '2Factor');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('NOTIFIER_EMAIL', 'zoho_smtp');
    vi.stubEnv('NOTIFIER_WHATSAPP', 'meta');
    vi.stubEnv('STORAGE_DRIVER', 's3');
    const s = deploymentSummary();
    expect(s).toMatchObject({ smsProvider: '2factor', emailProvider: 'zoho_smtp', whatsappProvider: 'meta', storageProvider: 's3' });
    expect(s).not.toHaveProperty('phase');
    expect(s).not.toHaveProperty('enabledFlags');
  });
  it('unset providers read as mock, not a pretend provider', () => {
    vi.stubEnv('NOTIFIER_SMS', '');
    vi.stubEnv('SMS_PROVIDER', '');
    vi.stubEnv('NOTIFIER_EMAIL', '');
    vi.stubEnv('EMAIL_PROVIDER', '');
    vi.stubEnv('SMTP_HOST', '');
    vi.stubEnv('STORAGE_DRIVER', '');
    const s = deploymentSummary();
    expect(s.smsProvider).toMatch(/^mock/);
    expect(s.emailProvider).toMatch(/^mock/);
    expect(s.storageProvider).toBe('local');
  });
});
