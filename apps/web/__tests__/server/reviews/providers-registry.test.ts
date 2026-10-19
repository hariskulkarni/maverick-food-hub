import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_LIST } from '@/server/integrations/providers';

describe('provider registry — reviews additions', () => {
  it('registers LLM_REVIEWS and GOOGLE_BUSINESS in PROVIDERS', () => {
    expect(PROVIDERS.LLM_REVIEWS).toBeDefined();
    expect(PROVIDERS.GOOGLE_BUSINESS).toBeDefined();
  });
  it('shows LLM_REVIEWS in the wizard list but not GOOGLE_BUSINESS', () => {
    const keys = PROVIDER_LIST.map((p) => p.key);
    expect(keys).toContain('LLM_REVIEWS');
    expect(keys).not.toContain('GOOGLE_BUSINESS');
  });
  it('LLM_REVIEWS marks the apiKey field as secret', () => {
    const f = PROVIDERS.LLM_REVIEWS.fields.find((x) => x.key === 'apiKey');
    expect(f?.secret).toBe(true);
  });
  it('buildSummary masks the apiKey', () => {
    const s = PROVIDERS.LLM_REVIEWS.buildSummary({ provider: 'nvidia', apiKey: 'nvapi-abcdef1234', model: 'm' });
    expect(JSON.stringify(s)).not.toContain('nvapi-abcdef1234');
  });
});
