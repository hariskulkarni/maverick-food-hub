import { describe, it, expect, afterEach } from 'vitest';
import { routeTemplate, setRouteTemplatesForTest, heuristicTemplate, classifyPath, jobNameFromPath, cleanAppPath } from '@/server/observability/routes';

afterEach(() => setRouteTemplatesForTest(null));

describe('route templates', () => {
  it('matches the Next manifest, static before dynamic before catch-all', () => {
    setRouteTemplatesForTest([
      '/api/orders/[id]/route',
      '/api/orders/active/route',
      '/api/orders/[id]/status/route',
      '/(customer)/r/[slug]/page',
      '/api/auth/[...nextauth]/route',
      '/docs/[[...path]]/page',
    ]);
    expect(routeTemplate('/api/orders/active')).toBe('/api/orders/active');
    expect(routeTemplate('/api/orders/cm1abc/status')).toBe('/api/orders/[id]/status');
    expect(routeTemplate('/api/orders/cm1abc')).toBe('/api/orders/[id]');
    expect(routeTemplate('/r/biryani-house')).toBe('/r/[slug]');
    expect(routeTemplate('/api/auth/callback/google')).toBe('/api/auth/[...nextauth]');
    expect(routeTemplate('/docs')).toBe('/docs/[[...path]]');
    expect(routeTemplate('/api/orders/cm1abc/?x=1')).toBe('/api/orders/[id]');
  });
  it('strips route groups and parallel slots', () => {
    expect(cleanAppPath('/(customer)/@modal/orders/[id]/page')).toBe('/orders/[id]');
  });
  it('falls back to id-stripping when the manifest has no match', () => {
    setRouteTemplatesForTest(['/api/x/route']);
    expect(heuristicTemplate('/api/orders/123/items/cm1abcdefghijklmnopqrstu')).toBe('/api/orders/[id]/items/[id]');
    expect(routeTemplate('/api/unknown/550e8400-e29b-41d4-a716-446655440000')).toBe('/api/unknown/[id]');
    expect(heuristicTemplate('/api/orders/ORD-AB12CD')).toBe('/api/orders/[id]');
    expect(heuristicTemplate('/restaurants/biryani-house')).toBe('/restaurants/biryani-house');
  });
  it('classifies what we record', () => {
    expect(classifyPath('/api/orders')).toBe('API');
    expect(classifyPath('/platform/orders')).toBe('PAGE');
    expect(classifyPath('/_next/static/chunk.js')).toBeNull();
    expect(classifyPath('/logo.png')).toBeNull();
    expect(classifyPath('/api/events/stream')).toBeNull();
    expect(classifyPath('/uploads/a.jpg')).toBeNull();
  });
  it('recognises job runner routes', () => {
    expect(jobNameFromPath('/api/platform/jobs/kyc-expiry/run')).toBe('kyc-expiry');
    expect(jobNameFromPath('/api/platform/jobs/kyc-expiry')).toBeNull();
  });
});
