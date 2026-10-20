import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_LIST } from '@/server/integrations/providers';

describe('YOUPI provider registry', () => {
  it('is registered in PROVIDERS but not in the generic wizard list', () => {
    expect(PROVIDERS.YOUPI).toBeDefined();
    expect(PROVIDERS.YOUPI.key).toBe('YOUPI');
    expect(PROVIDER_LIST.map((p) => p.key)).not.toContain('YOUPI');
  });

  it('marks apiKey and webhookSecret as secret', () => {
    const f = (n: string) => PROVIDERS.YOUPI.fields.find((x) => x.key === n);
    expect(f('apiKey')?.secret).toBe(true);
    expect(f('webhookSecret')?.secret).toBe(true);
  });

  it('buildSummary never leaks raw secrets', () => {
    const s = PROVIDERS.YOUPI.buildSummary({
      baseUrl: 'https://pg.example.com',
      receivingVpa: 'shop@upi',
      apiKey: 'RAW_API_KEY_123456789',
      webhookSecret: 'RAW_WEBHOOK_SECRET_987654321',
    });
    const str = JSON.stringify(s);
    expect(str).not.toContain('RAW_API_KEY_123456789');
    expect(str).not.toContain('RAW_WEBHOOK_SECRET_987654321');
    expect(str).toContain('shop@upi');
  });
});
