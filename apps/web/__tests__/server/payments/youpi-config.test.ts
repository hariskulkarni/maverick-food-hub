import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_LIST } from '@/server/integrations/providers';

describe('YOUPI provider registry', () => {
  it('is registered in PROVIDERS but not in the generic wizard list', () => {
    expect(PROVIDERS.YOUPI).toBeDefined();
    expect(PROVIDERS.YOUPI.key).toBe('YOUPI');
    expect(PROVIDER_LIST.map((p) => p.key)).not.toContain('YOUPI');
  });

  it('merchantId is a required public field; webhookSecret is the secret (no apiKey)', () => {
    const f = (n: string) => PROVIDERS.YOUPI.fields.find((x) => x.key === n);
    expect(f('apiKey')).toBeUndefined(); // YouPI-PG has no Bearer key
    expect(f('merchantId')?.required).toBe(true);
    expect(f('merchantId')?.secret).toBeFalsy(); // X-Merchant-Id is a public UUID
    expect(f('webhookSecret')?.secret).toBe(true);
  });

  it('buildSummary shows the public merchantId but masks the webhook secret', () => {
    const s = PROVIDERS.YOUPI.buildSummary({
      baseUrl: 'https://pg.example.com',
      merchantId: 'merchant-uuid-123',
      receivingVpa: 'shop@upi',
      webhookSecret: 'RAW_WEBHOOK_SECRET_987654321',
    });
    const str = JSON.stringify(s);
    expect(str).not.toContain('RAW_WEBHOOK_SECRET_987654321');
    expect(str).toContain('shop@upi');
    expect(str).toContain('merchant-uuid-123');
  });
});
