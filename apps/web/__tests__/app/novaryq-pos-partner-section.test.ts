/**
 * ADR-FNI-001 §4.4: the restaurant-acquisition page shows the "powered by Novaryq" POS-partner
 * section only while the integration is live, and makes no claim beyond what the integration does.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/(customer)/signup/restaurant/form', () => ({ RestaurantSignupForm: () => null }));
vi.mock('@/server/integrations', () => ({ getConfig: vi.fn() }));

import RestaurantSignupPage from '@/app/(customer)/signup/restaurant/page';

afterEach(() => vi.unstubAllEnvs());

describe('restaurant signup page — POS partner section', () => {
  it('is hidden while NOVARYQ_INTEGRATION_ENABLED is off', () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    expect(renderToStaticMarkup(RestaurantSignupPage())).not.toContain('Novaryq');
  });

  it('is shown when on: India-only, links novaryq.in, no numbers or testimonials', () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
    const html = renderToStaticMarkup(RestaurantSignupPage());
    expect(html).toContain('powered by Novaryq');
    expect(html).toContain('href="https://novaryq.in"');
    expect(html).toContain('Novaryq India (INR)');
    const section = html.slice(html.indexOf('pos-partner'));
    expect(section).not.toMatch(/\d+\s*(%|\+|restaurants|customers)/i);
  });
});
