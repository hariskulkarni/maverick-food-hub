import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { decimalToPaise, paiseToInrString } from '@/server/pg/money';

describe('pg money', () => {
  it('converts decimals exactly', () => {
    expect(decimalToPaise(new Prisma.Decimal('1234.56'))).toBe(123456);
    expect(decimalToPaise('0.1')).toBe(10);
    expect(decimalToPaise(0.29)).toBe(29); // 0.29*100 = 28.999999999999996 in float
    expect(decimalToPaise(1.15)).toBe(115);
    expect(decimalToPaise('7')).toBe(700);
  });
  it('rejects sub-paise, negative and junk', () => {
    for (const bad of ['1.005', '-1.00', 'abc', '', NaN, Infinity, 1.005]) {
      expect(() => decimalToPaise(bad as never)).toThrow();
    }
  });
  it('formats paise', () => {
    expect(paiseToInrString(123456)).toBe('1234.56');
    expect(paiseToInrString(5)).toBe('0.05');
    expect(() => paiseToInrString(1.5)).toThrow();
  });
});
