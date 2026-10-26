import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { csvCell, maskReceivingAccount } from '@/server/pg/reports';
import { normalizeRefundReference } from '@/server/pg/refunds';

describe('csvCell (RFC 4180 + formula-injection safe)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+91 99', "'+91 99"],
    ['-cmd', "'-cmd"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tx', "'\tx"],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['=a,"b"', `"'=a,""b"""`],
    ['plain', 'plain'],
  ])('%j -> %j', (v, out) => expect(csvCell(v)).toBe(out));

  it('numbers (incl. negative paise) and nulls are written as-is', () => {
    expect(csvCell(-2500)).toBe('-2500');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('maskReceivingAccount', () => {
  it('never shows the full VPA or account number', () => {
    expect(maskReceivingAccount('merchant@okhdfc', '1234')).toBe('me***@okhdfc / XXXX1234');
    expect(maskReceivingAccount('ab@upi', null)).toBe('ab***@upi');
    expect(maskReceivingAccount(null, '987654321')).toBe('XXXX4321');
  });
});

describe('normalizeRefundReference', () => {
  it('trims and uppercases a human-entered 6-35 alnum reference', () => {
    expect(normalizeRefundReference('  utr123456 ')).toBe('UTR123456');
    expect(normalizeRefundReference('A'.repeat(35))).toBe('A'.repeat(35));
  });
  it.each([undefined, null, '', '12345', 'A'.repeat(36), 'UTR-12345', 'UTR 12345', 123456])('rejects %j', (v) =>
    expect(normalizeRefundReference(v)).toBeNull(),
  );
});
