/**
 * Masked calling: riders must never receive a customer's real phone number.
 *
 *   1. Runtime — GET /api/rider/assignments with a customer row that HAS a phone
 *      (the mock ignores `select`, as a careless include would): the response is
 *      scanned for the number's digits and must carry only the masked hint.
 *   2. Static — every /api/rider/** route and the rider-native app source are
 *      scanned so a future change can't quietly re-expose the number
 *      (customer phone selected without masking, or a tel: link to a customer).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CUSTOMER_PHONE = '+919876543210';

vi.mock('@/server/rider-auth', () => ({ auth: async () => ({ user: { id: 'u1', role: 'RIDER' } }) }));
vi.mock('@/lib/demo', () => ({ isDemoMode: () => false }));
vi.mock('@/server/db', () => ({
  prisma: {
    riderProfile: { findUnique: async () => ({ id: 'rp1' }) },
    riderAssignment: {
      findMany: async () => [
        {
          id: 'a1',
          riderId: 'rp1',
          status: 'PICKED_UP',
          order: {
            id: 'o1',
            code: 'ORD-1',
            status: 'OUT_FOR_DELIVERY',
            customerId: 'c1',
            deliveryOtp: '1234',
            pickupCode: '9999',
            items: [],
            customer: { id: 'c1', name: 'Asha', phone: CUSTOMER_PHONE, email: 'a@x.in', passwordHash: 'h' },
            address: { line1: '1 MG Rd', city: 'Pune', latitude: 1, longitude: 2 },
            branch: { id: 'b1', name: 'Main', restaurant: { id: 'r1', name: 'R' } },
          },
        },
      ],
    },
  },
}));

import { GET } from '@/app/api/rider/assignments/route';

describe('rider assignments payload', () => {
  it('never contains the customer phone — name + "+91 ******10" only', async () => {
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('"phone"');
    const [a] = JSON.parse(text);
    expect(a.order.customer).toEqual({ id: 'c1', name: 'Asha', maskedPhone: '+91 ******10' });
  });
});

const WEB = path.resolve(__dirname, '../..');
const RIDER_API = path.join(WEB, 'src/app/api/rider');
const RIDER_NATIVE = path.resolve(WEB, '../rider-native');

function walk(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name === 'node_modules' || d.name.startsWith('.')) return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, exts) : exts.some((e) => p.endsWith(e)) ? [p] : [];
  });
}

describe('static guards', () => {
  it('no /api/rider route selects the customer phone without masking it', () => {
    const files = walk(RIDER_API, ['.ts']);
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      const selectsPhone = /customer:\s*(true|\{[^}]*phone:\s*true)/.test(src);
      return selectsPhone && !src.includes('maskPhone(');
    });
    expect(offenders.map((f) => path.relative(WEB, f))).toEqual([]);
  });

  it('the rider app never dials the customer directly or reads customer.phone', () => {
    const files = walk(path.join(RIDER_NATIVE, 'app'), ['.ts', '.tsx']).concat(walk(path.join(RIDER_NATIVE, 'lib'), ['.ts', '.tsx']), walk(path.join(RIDER_NATIVE, 'components'), ['.ts', '.tsx']));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => /customer\??\.phone\b/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(RIDER_NATIVE, f))).toEqual([]);
  });
});
