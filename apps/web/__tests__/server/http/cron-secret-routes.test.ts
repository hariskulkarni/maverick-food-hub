import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { secretMatches } from '@/server/http/secret-compare';

describe('secretMatches (T-17)', () => {
  it('matches only the exact secret', () => {
    expect(secretMatches('fake-cron-secret', 'fake-cron-secret')).toBe(true);
    expect(secretMatches('fake-cron-secreT', 'fake-cron-secret')).toBe(false);
    expect(secretMatches('fake-cron-secret-longer', 'fake-cron-secret')).toBe(false);
    expect(secretMatches('fake', 'fake-cron-secret')).toBe(false);
  });
  it('fails closed when either side is missing or empty', () => {
    expect(secretMatches(null, 'fake-cron-secret')).toBe(false);
    expect(secretMatches('fake-cron-secret', undefined)).toBe(false);
    expect(secretMatches('', '')).toBe(false);
    expect(secretMatches(undefined, undefined)).toBe(false);
  });
});

const JOB_ROUTES = ['food-license-expiry', 'google-reviews', 'kyc-expiry', 'phonepe-reconcile', 'rider-shift-missed']
  .map((j) => `src/app/api/platform/jobs/${j}/run/route.ts`);
// Kept GET because no repo cron line shows how they are called (see SECURITY_THREAT_MODEL T-17).
const OTHER_CRON_ROUTES = ['src/app/api/platform/escalations/scan/route.ts', 'src/app/api/platform/rider-heartbeat/sweep/route.ts'];

describe('cron routes (T-17)', () => {
  it('platform/jobs/*/run routes are POST-only', () => {
    for (const f of JOB_ROUTES) expect(readFileSync(f, 'utf8'), f).not.toMatch(/export\s+(const|async function)\s+GET/);
  });
  it('every cron route compares the secret in constant time', () => {
    for (const f of [...JOB_ROUTES, ...OTHER_CRON_ROUTES]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain('secretMatches(headerSecret, internalSecret)');
      expect(src, f).not.toMatch(/headerSecret\s*===|===\s*headerSecret/);
    }
  });
});
