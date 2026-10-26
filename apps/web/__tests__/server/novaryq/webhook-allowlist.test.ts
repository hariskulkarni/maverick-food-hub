/**
 * The Novaryq webhook (signature-verified per restaurant) skips CSRF and the API
 * rate limiter — and ONLY that exact path shape does.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { csrfGuard, isWebhookPath } from '@/server/http/csrf';

const xs = { host: 'flavrly.example', 'sec-fetch-site': 'cross-site', origin: 'https://novaryq.example' };
const run = (path: string) => csrfGuard(new NextRequest(`https://flavrly.example${path}`, { method: 'POST', headers: xs }), path);

describe('Novaryq webhook allowlist', () => {
  it('exempts /api/integrations/novaryq/webhook/<restaurantId>', () => {
    expect(isWebhookPath('/api/integrations/novaryq/webhook/cmh0abc123')).toBe(true);
    expect(isWebhookPath('/api/integrations/novaryq/webhook/cmh0abc123/')).toBe(true);
    expect(run('/api/integrations/novaryq/webhook/cmh0abc123')).toBeNull();
  });

  it('does not exempt anything else under the prefix', () => {
    for (const p of [
      '/api/integrations/novaryq/webhook',
      '/api/integrations/novaryq/webhook/a/b',
      '/api/integrations/novaryq/webhook/a.b',
      '/api/integrations/novaryq/other/abc',
      '/api/admin/integrations/novaryq/webhook',
    ]) {
      expect(isWebhookPath(p), p).toBe(false);
      expect(run(p)?.status, p).toBe(403);
    }
  });
});
