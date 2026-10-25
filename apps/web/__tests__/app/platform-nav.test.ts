import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  PLATFORM_NAV,
  activeHref,
  filterNavByAccess,
  filterNavByQuery,
} from '@/app/platform/_nav/nav-config';
import { can, pageGateFor } from '@/server/permissions';

const allHrefs = () => PLATFORM_NAV.flatMap((g) => g.items.map((it) => it.href));

// The flat list the sidebar had before it was grouped (platform/layout.tsx, 2026-10-25).
const PREVIOUS_LINKS = [
  '/platform', '/platform/analytics', '/platform/restaurants', '/platform/brands', '/platform/payment-gateways',
  '/platform/youpi', '/platform/youpi-admin', '/platform/discovery-cms', '/platform/signup-bonus', '/platform/orders',
  '/platform/live', '/platform/feedback', '/platform/reviews-analytics', '/platform/live-ops', '/platform/dispatch-insights',
  '/platform/riders', '/platform/kyc', '/platform/payouts', '/platform/cod', '/platform/iam', '/platform/approvals',
  '/platform/users', '/platform/support', '/platform/help', '/platform/qr', '/platform/settlements', '/platform/reports',
  '/platform/security', '/platform/audit-log', '/platform/system-health', '/platform/observability',
  '/platform/messages', '/platform/rider-payouts', '/platform/rider-incentives', '/platform/surge-zones',
  '/platform/rider-tiers', '/platform/rider-referrals', '/platform/rider-sos', '/platform/rider-incidents',
  '/platform/rider-shifts', '/platform/rider-support', '/platform/training-modules', '/platform/rider-settings',
  '/platform/app-releases',
];

describe('platform nav config', () => {
  it('keeps every previous link, each exactly once', () => {
    const hrefs = allHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual([...PREVIOUS_LINKS].sort());
  });

  it('links every top-level /platform page and only real pages', () => {
    const dir = path.join(__dirname, '../../src/app/platform');
    const pages = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(path.join(dir, d.name, 'page.tsx')))
      .map((d) => `/platform/${d.name}`);
    expect([...allHrefs()].sort()).toEqual(['/platform', ...pages].sort());
  });

  it('groups items by operation with unique group ids', () => {
    const ids = PLATFORM_NAV.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of PLATFORM_NAV) expect(g.items.length).toBeGreaterThan(0);
  });
});

describe('filterNavByQuery', () => {
  const labels = (q: string) => filterNavByQuery(PLATFORM_NAV, q).flatMap((g) => g.items.map((it) => it.label));

  it('returns everything for an empty query', () => {
    expect(filterNavByQuery(PLATFORM_NAV, '   ')).toEqual(PLATFORM_NAV);
  });

  it('matches labels case-insensitively', () => {
    expect(labels('AUDIT')).toEqual(['Audit log']);
  });

  it('matches keyword aliases (kyc, upi)', () => {
    expect(labels('kyc')).toEqual(expect.arrayContaining(['KYC review', 'Rider settings']));
    expect(labels('upi')).toEqual(['Payment gateways', 'Flavrly PG', 'Flavrly PG Admin']);
  });

  it('matches the group title and requires every term', () => {
    expect(labels('finance cod')).toEqual(['COD']);
    expect(labels('kyc zzz')).toEqual([]);
  });

  it('drops groups with no matches', () => {
    const groups = filterNavByQuery(PLATFORM_NAV, 'sos');
    expect(groups.map((g) => g.id)).toEqual(['rider-safety']);
  });
});

describe('activeHref', () => {
  it('uses the longest matching prefix on a path boundary', () => {
    expect(activeHref(PLATFORM_NAV, '/platform')).toBe('/platform');
    expect(activeHref(PLATFORM_NAV, '/platform/restaurants/abc/edit')).toBe('/platform/restaurants');
    expect(activeHref(PLATFORM_NAV, '/platform/live-ops')).toBe('/platform/live-ops');
    expect(activeHref(PLATFORM_NAV, '/platform/youpi-admin')).toBe('/platform/youpi-admin');
    expect(activeHref(PLATFORM_NAV, '/platform/youpi/accounts')).toBe('/platform/youpi');
    expect(activeHref(PLATFORM_NAV, '/admin')).toBeNull();
  });
});

describe('filterNavByAccess (capability filtering stays server-side)', () => {
  const visible = (role: string) =>
    filterNavByAccess(PLATFORM_NAV, (href) => can(role, pageGateFor(href))).flatMap((g) => g.items.map((it) => it.href));

  it('shows SUPER_ADMIN every page', () => {
    expect(visible('SUPER_ADMIN').length).toBe(PREVIOUS_LINKS.length);
  });

  it('hides finance, IAM and platform-admin pages from a GUEST and drops empty groups', () => {
    const guest = visible('GUEST');
    for (const hidden of ['/platform/settlements', '/platform/cod', '/platform/youpi', '/platform/iam', '/platform/users', '/platform/security']) {
      expect(guest).not.toContain(hidden);
    }
    expect(guest).toContain('/platform/orders');
    const groupIds = filterNavByAccess(PLATFORM_NAV, (href) => can('GUEST', pageGateFor(href))).map((g) => g.id);
    expect(groupIds).not.toContain('finance');
  });

  it('matches the old per-link filtering for every delegated role', () => {
    for (const role of ['ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST']) {
      const expected = PREVIOUS_LINKS.filter((href) => can(role, pageGateFor(href))).sort();
      expect(visible(role).sort()).toEqual(expected);
    }
  });
});
