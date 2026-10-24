import { describe, expect, it } from 'vitest';
import {
  normalizeBankReference,
  parseInrAmount,
  parseStatementCsv,
  parseStatementDate,
  readCsv,
  redactNarration,
  type StatementColumnMapping,
} from '@/server/pg/bank-source';

const mapping: StatementColumnMapping = {
  date: 'Txn Date',
  valueDate: 'Value Date',
  narration: 'Description',
  reference: 'Ref No',
  credit: 'Credit',
  debit: 'Debit',
  dateFormat: 'DD/MM/YYYY',
};

describe('bank-source CSV parser', () => {
  it('parses amounts exactly to paise (no float drift)', () => {
    expect(parseInrAmount('0.29')).toBe(29);
    expect(parseInrAmount('1,234.50')).toBe(123450);
    expect(parseInrAmount('₹ 10')).toBe(1000);
    expect(parseInrAmount('')).toBeNull();
    expect(() => parseInrAmount('1.234')).toThrow(/unparseable/);
    expect(() => parseInrAmount('-5.00')).toThrow(/unparseable/);
  });

  it('normalizes references and redacts narration', () => {
    expect(normalizeBankReference('  ab 12\tcd ')).toBe('AB12CD');
    const n = redactNarration('UPI/412345678901/payer.name@okaxis/Flavrly order')!;
    expect(n).not.toContain('412345678901');
    expect(n).toContain('XXXX8901');
    expect(n).not.toContain('payer.name@');
    expect(redactNarration('x'.repeat(200))!.length).toBeLessThanOrEqual(64);
  });

  it('pins date-only statement rows to 23:59:59.999 IST', () => {
    expect(parseStatementDate('24/10/2026', 'DD/MM/YYYY').toISOString()).toBe('2026-10-24T18:29:59.999Z');
    expect(parseStatementDate('24-Oct-2026', 'DD-MMM-YYYY').toISOString()).toBe('2026-10-24T18:29:59.999Z');
    expect(() => parseStatementDate('31/02/2026', 'DD/MM/YYYY')).toThrow(/calendar/);
  });

  it('reads quoted CSV fields', () => {
    expect(readCsv('a,"b,""c"""\r\n1,2\n')).toEqual([
      { line: 1, cells: ['a', 'b,"c"'] },
      { line: 2, cells: ['1', '2'] },
    ]);
  });

  it('finds the header after preamble, maps columns, rejects bad rows with reasons', () => {
    const csv = [
      'Account Statement,,,,,',
      'Txn Date,Value Date,Description,Ref No,Debit,Credit',
      '24/10/2026,24/10/2026,UPI credit,utr 0001,,250.00',
      '24/10/2026,,UPI debit,UTR0002,"1,000.10",',
      '24/10/2026,,no ref,,,5.00',
      '24/10/2026,,both,UTR0003,1.00,2.00',
      '24/10/2026,,bad amt,UTR0004,,12.345',
      '99/99/2026,,bad date,UTR0005,,1.00',
      '24/10/2026,,zero,UTR0006,0.00,0.00',
    ].join('\n');
    const r = parseStatementCsv(csv, mapping);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ direction: 'CREDIT', amountPaise: 25000, bankReference: 'UTR0001', currency: 'INR' });
    expect(r.rows[1]).toMatchObject({ direction: 'DEBIT', amountPaise: 100010, bankReference: 'UTR0002' });
    expect(r.rows[0].sourceRowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.rejected.map((x) => x.line)).toEqual([5, 6, 7, 8, 9]);
    expect(r.rejected[0].reason).toMatch(/missing reference/);
    expect(r.rejected[1].reason).toMatch(/both credit and debit/);
    expect(r.rejected[2].reason).toMatch(/unparseable amount/);
    expect(r.rejected[3].reason).toMatch(/does not match|calendar/);
    expect(r.rejected[4].reason).toMatch(/no non-zero/);
  });

  it('reports a missing header instead of guessing', () => {
    const r = parseStatementCsv('a,b\n1,2', mapping);
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/header row/);
  });
});
