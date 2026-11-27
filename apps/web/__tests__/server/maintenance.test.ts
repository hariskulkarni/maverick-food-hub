/**
 * Maintenance mode: the path policy and the flag store.
 *
 * The path policy is where a mistake is most expensive and least visible: an
 * over-broad gate serves an unstyled holding page or 503s the health probe
 * (so pm2 restarts the app mid-window); an under-broad one leaves a door open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isMaintenanceExemptPath,
  wantsJsonMaintenanceResponse,
  isMaintenanceInfraPath,
  loopbackStatusOrigin,
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_BYPASS_SCOPE,
  MAINTENANCE_STATUS_ENDPOINT,
  UNDER_CONSTRUCTION_PATH,
} from '@/server/maintenance-paths';

// The flag store reads/writes one PlatformFlag row; stub that boundary.
type Row = { key: string; value: unknown; updatedBy: string | null; updatedAt: Date } | null;
const store: { row: Row } = { row: null };
vi.mock('@/server/db', () => ({
  prisma: {
    platformFlag: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.row && store.row.key === where.key ? store.row : null,
      upsert: async ({ where, update, create }: { where: { key: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        store.row =
          store.row && store.row.key === where.key
            ? ({ ...store.row, ...update, updatedAt: new Date() } as Row)
            : ({ ...(create as object), updatedAt: new Date() } as Row);
        return store.row;
      },
    },
  },
}));

import { getMaintenance, setMaintenance, normalizeMaintenanceMessage, MAX_MAINTENANCE_MESSAGE, MAINTENANCE_FLAG_KEY } from '@/server/maintenance';

beforeEach(() => {
  store.row = null;
});

describe('exempt paths — must keep working while closed', () => {
  it('serves the holding page and its own machinery', () => {
    expect(isMaintenanceExemptPath(UNDER_CONSTRUCTION_PATH)).toBe(true);
    expect(isMaintenanceExemptPath('/maintenance-bypass')).toBe(true);
    expect(isMaintenanceExemptPath(MAINTENANCE_STATUS_ENDPOINT)).toBe(true);
  });

  it('serves the asset pipeline, or the holding page renders unstyled', () => {
    for (const p of [
      '/_next/static/chunks/main.js',
      '/_next/image',
      '/uploads/dish.jpg',
      '/favicon.ico',
      '/icon.svg',
      '/styles.css',
      '/manifest.webmanifest',
    ]) {
      expect(isMaintenanceExemptPath(p)).toBe(true);
    }
  });

  it('keeps liveness probes green so pm2 does not restart the app mid-window', () => {
    expect(isMaintenanceExemptPath('/api/system/health')).toBe(true);
    expect(isMaintenanceExemptPath('/api/ready')).toBe(true);
  });

  it('never drops a payment webhook', () => {
    // A capture callback that never lands is a customer charged for nothing.
    expect(isMaintenanceExemptPath('/api/payments/razorpay/webhook')).toBe(true);
    expect(isMaintenanceExemptPath('/api/payments/phonepe/webhook')).toBe(true);
  });

  it('closes everything else, staff surfaces included', () => {
    for (const p of [
      '/',
      '/restaurants',
      '/r/combo-nation',
      '/checkout',
      '/login',
      '/admin',
      '/admin/orders',
      '/kitchen',
      '/platform',
      '/platform/iam',
      '/api/me',
      '/api/orders',
      '/api/rider/pool',
      '/api/admin/menu/items',
    ]) {
      expect(isMaintenanceExemptPath(p)).toBe(false);
    }
  });

  it('does not exempt on a shared prefix', () => {
    expect(isMaintenanceExemptPath('/api/system/health-history')).toBe(false);
    expect(isMaintenanceExemptPath('/under-construction-notes')).toBe(false);
    expect(isMaintenanceExemptPath('/downloads-page')).toBe(false);
  });
});

describe('routes valid on BOTH hostnames', () => {
  it('lets the holding page and the claim route through the domain split', () => {
    // Bypass cookies are host-only, so an operator must be able to claim one
    // ON the portal. Without this the domain split would bounce them to the
    // customer site, where the cookie it sets is useless.
    expect(isMaintenanceInfraPath('/under-construction')).toBe(true);
    expect(isMaintenanceInfraPath('/maintenance-bypass')).toBe(true);
  });
  it('does not widen the split exemption to anything else', () => {
    for (const p of ['/admin', '/login', '/api/system/maintenance', '/under-construction-notes']) {
      expect(isMaintenanceInfraPath(p)).toBe(false);
    }
  });
});

describe('loopback status origin \u2014 regression, prod outage 2026-11-27', () => {
  it('forces http and 127.0.0.1, never the scheme from nextUrl', () => {
    // Next 15.5.28 honours X-Forwarded-Proto when building nextUrl, so behind
    // nginx it reads `https://localhost:3000` -- https scheme, loopback host.
    // Deriving the origin from it meant TLS against a plain HTTP port, an
    // instant "wrong version number", and a gate that silently failed open.
    // 15.5.18 did not honour that header, so it passed every local test.
    expect(loopbackStatusOrigin({ port: '3000' })).toBe('http://127.0.0.1:3000');
    expect(loopbackStatusOrigin({ port: '3000' })).not.toContain('https');
    expect(loopbackStatusOrigin({ port: '3000' })).not.toContain('localhost');
  });

  it('keeps a non-default port so a relocated app still reads its own flag', () => {
    expect(loopbackStatusOrigin({ port: '3001' })).toBe('http://127.0.0.1:3001');
  });

  it('falls back to PORT, then to Next default', () => {
    expect(loopbackStatusOrigin({}, { PORT: '4000' })).toBe('http://127.0.0.1:4000');
    expect(loopbackStatusOrigin({})).toBe('http://127.0.0.1:3000');
  });

  it('honours an explicit override, trailing slash and all', () => {
    expect(
      loopbackStatusOrigin({ port: '3000' }, { MAINTENANCE_STATUS_ORIGIN: 'http://app.internal:8080/' }),
    ).toBe('http://app.internal:8080');
  });
});

describe('response shape', () => {
  it('gives API callers JSON and browsers the holding page', () => {
    expect(wantsJsonMaintenanceResponse('/api/orders')).toBe(true);
    expect(wantsJsonMaintenanceResponse('/restaurants')).toBe(false);
    expect(wantsJsonMaintenanceResponse('/admin')).toBe(false);
  });
});

describe('constants are stable', () => {
  it('names the cookie and scope the middleware and route both rely on', () => {
    expect(MAINTENANCE_BYPASS_COOKIE).toBe('flavrly_maintenance_bypass');
    expect(MAINTENANCE_BYPASS_SCOPE).toBe('maintenance-bypass');
    expect(MAINTENANCE_FLAG_KEY).toBe('maintenance');
  });
});

describe('message normalisation', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(normalizeMaintenanceMessage('  back   by  2am  ')).toBe('back by 2am');
    expect(normalizeMaintenanceMessage('x'.repeat(400))).toHaveLength(MAX_MAINTENANCE_MESSAGE);
  });
  it('treats blank and non-strings as no message', () => {
    for (const v of ['', '   ', null, undefined, 42, {}]) {
      expect(normalizeMaintenanceMessage(v)).toBeNull();
    }
  });
});

describe('flag store', () => {
  it('is off by default', async () => {
    expect(await getMaintenance()).toEqual({ on: false, message: null, since: null, by: null });
  });

  it('turns on with a message, timestamp and operator', async () => {
    const s = await setMaintenance(true, { message: 'DB migration', by: 'cli:harish@vps' });
    expect(s.on).toBe(true);
    expect(s.message).toBe('DB migration');
    expect(s.by).toBe('cli:harish@vps');
    expect(Date.parse(s.since!)).toBeGreaterThan(0);
    expect(await getMaintenance()).toEqual(s);
  });

  it('keeps the original start time across a re-enable', async () => {
    const first = await setMaintenance(true, { message: 'one' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await setMaintenance(true, { message: 'two' });
    expect(second.since).toBe(first.since);
    expect(second.message).toBe('two');
  });

  it('turning off leaves no stale message or operator behind', async () => {
    await setMaintenance(true, { message: 'secret-ish internal note', by: 'cli:someone' });
    expect(await setMaintenance(false)).toEqual({ on: false, message: null, since: null, by: null });
    // `value` is replaced wholesale, so nothing is left to resurface later.
    expect(JSON.stringify(store.row)).not.toContain('secret-ish');
  });

  it('re-enabling after an off starts a fresh window', async () => {
    const a = await setMaintenance(true);
    await setMaintenance(false);
    await new Promise((r) => setTimeout(r, 5));
    const b = await setMaintenance(true);
    expect(b.since).not.toBe(a.since);
  });

  it('fails OPEN when the row cannot be read', async () => {
    // A database blip must not be able to close the site — the switch to
    // reopen it lives in that same database.
    const { prisma } = await import('@/server/db');
    const spy = vi
      .spyOn(prisma.platformFlag, 'findUnique')
      .mockRejectedValue(new Error('db down') as never);
    expect(await getMaintenance()).toEqual({ on: false, message: null, since: null, by: null });
    spy.mockRestore();
  });

  it('ignores a malformed flag rather than closing the site', async () => {
    store.row = { key: 'maintenance', value: { on: 'yes' }, updatedBy: null, updatedAt: new Date() };
    expect((await getMaintenance()).on).toBe(false);
    store.row = { key: 'maintenance', value: null, updatedBy: null, updatedAt: new Date() };
    expect((await getMaintenance()).on).toBe(false);
  });
});
