/**
 * Bank transaction sources (master prompt §9 "BANK TRANSACTION NORMALIZATION").
 *
 * `BankTransactionSource` is the plug point for an AUTHORIZED bank/acquirer feed or a
 * provider settlement API. No such feed is authorized today (contract D4), so there is
 * deliberately no implementation here: nothing in this file talks to a bank.
 *
 * What IS implemented: a generic, header-mapped CSV statement parser. Banks differ in
 * column names, so the caller supplies the mapping. Amounts are parsed exactly to integer
 * paise (never via float), references are normalized, narrations are redacted+truncated,
 * and every row that cannot be parsed is rejected with a reason instead of guessed.
 */
import { createHash } from 'node:crypto';
import type { PgBankSource, PgTxnDirection } from '@prisma/client';
import { decimalToPaise } from './money';

export interface NormalizedBankTxn {
  direction: PgTxnDirection;
  amountPaise: number;
  currency: 'INR';
  /** Normalized UTR/RRN: trimmed, upper-case, all whitespace removed. */
  bankReference: string;
  valueAt: Date;
  narrationRedacted: string | null;
  counterpartyMasked: string | null;
  /** sha256 of the canonical source row; audit link back to the statement line. */
  sourceRowHash: string;
}

/** An authorized, read-only feed of bank movements for ONE receiving account. */
export interface BankTransactionSource {
  readonly kind: Exclude<PgBankSource, 'MANUAL' | 'STATEMENT_IMPORT'>;
  readonly receivingAccountId: string;
  /** Rows strictly after `cursor` (opaque, source-defined) plus the next cursor. */
  fetchSince(cursor: string | null): Promise<{ rows: NormalizedBankTxn[]; nextCursor: string | null }>;
}

export type StatementDateFormat = 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'YYYY-MM-DD' | 'DD-MMM-YYYY' | 'DD MMM YYYY';

export interface StatementColumnMapping {
  /** Header names exactly as they appear in the file (matched case-insensitively, trimmed). */
  date: string;
  valueDate?: string;
  narration?: string;
  reference: string;
  credit: string;
  debit?: string;
  dateFormat: StatementDateFormat;
}

export interface RejectedRow {
  line: number;
  reason: string;
}

export interface ParsedStatement {
  rows: NormalizedBankTxn[];
  rejected: RejectedRow[];
}

const NARRATION_MAX = 64;
const IST_OFFSET_MIN = 330;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function normalizeBankReference(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** Mask digit runs (account/phone numbers) and VPA local parts; then truncate. */
export function redactNarration(raw: string): string | null {
  const s = raw
    .replace(/[A-Za-z0-9._-]+@[A-Za-z][A-Za-z0-9.-]*/g, (vpa) => `${vpa[0]}***@${vpa.split('@')[1]}`)
    .replace(/\d{6,}/g, (d) => `XXXX${d.slice(-4)}`)
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  return s.length > NARRATION_MAX ? `${s.slice(0, NARRATION_MAX - 1)}…` : s;
}

/** Exact INR string -> paise. Accepts "1,234.50", "₹ 1234.5", "INR 10"; rejects negatives/3dp/junk. */
export function parseInrAmount(raw: string): number | null {
  const s = raw.replace(/₹|INR|Rs\.?|,|\s/gi, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`unparseable amount "${raw.trim()}"`);
  return decimalToPaise(s);
}

/**
 * Statement dates carry no time: interpret them in IST and pin to 23:59:59.999 IST of that
 * day, so a payment made any time on that day is never "before" its own credit when the
 * engine applies the [attempt.createdAt - 10min, attempt.createdAt + 48h] window.
 */
export function parseStatementDate(raw: string, fmt: StatementDateFormat): Date {
  const s = raw.trim();
  let d: number, m: number, y: number;
  let match: RegExpExecArray | null;
  switch (fmt) {
    case 'DD/MM/YYYY':
    case 'DD-MM-YYYY': {
      const sep = fmt[2] === '/' ? '/' : '-';
      match = new RegExp(`^(\\d{1,2})\\${sep}(\\d{1,2})\\${sep}(\\d{4})$`).exec(s);
      if (!match) throw new Error(`date "${s}" does not match ${fmt}`);
      [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    }
    case 'YYYY-MM-DD':
      match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!match) throw new Error(`date "${s}" does not match ${fmt}`);
      [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
      break;
    case 'DD-MMM-YYYY':
    case 'DD MMM YYYY': {
      match = /^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/.exec(s);
      const mi = match ? MONTHS.indexOf(match[2].toUpperCase()) : -1;
      if (!match || mi < 0) throw new Error(`date "${s}" does not match ${fmt}`);
      [d, m, y] = [Number(match[1]), mi + 1, Number(match[3])];
      break;
    }
  }
  const utc = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`date "${s}" is not a calendar date`);
  }
  return new Date(utc - IST_OFFSET_MIN * 60_000);
}

/** Minimal RFC 4180 CSV reader (quoted fields, "" escapes, CRLF/LF). Returns rows with 1-based line numbers. */
export function readCsv(text: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === '\n') line++;
        cell += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      cells.push(cell);
      if (cells.some((x) => x.trim() !== '')) out.push({ line: rowLine, cells });
      cells = [];
      cell = '';
      line++;
      rowLine = line;
    } else cell += c;
  }
  cells.push(cell);
  if (cells.some((x) => x.trim() !== '')) out.push({ line: rowLine, cells });
  return out;
}

/**
 * Parse a bank statement CSV with a caller-supplied header mapping. The header row is the
 * first row that contains every mapped column (statements often have preamble lines).
 */
export function parseStatementCsv(text: string, mapping: StatementColumnMapping): ParsedStatement {
  const table = readCsv(text);
  const want = [mapping.date, mapping.valueDate, mapping.narration, mapping.reference, mapping.credit, mapping.debit]
    .filter((h): h is string => !!h)
    .map((h) => h.trim().toLowerCase());
  const headerIdx = table.findIndex((r) => {
    const names = r.cells.map((c) => c.trim().toLowerCase());
    return want.every((w) => names.includes(w));
  });
  if (headerIdx < 0) {
    return { rows: [], rejected: [{ line: 0, reason: `header row with columns [${want.join(', ')}] not found` }] };
  }
  const header = table[headerIdx].cells.map((c) => c.trim().toLowerCase());
  const col = (name?: string) => (name ? header.indexOf(name.trim().toLowerCase()) : -1);
  const iDate = col(mapping.date);
  const iValue = col(mapping.valueDate);
  const iNarr = col(mapping.narration);
  const iRef = col(mapping.reference);
  const iCr = col(mapping.credit);
  const iDr = col(mapping.debit);

  const rows: NormalizedBankTxn[] = [];
  const rejected: RejectedRow[] = [];
  for (const { line, cells } of table.slice(headerIdx + 1)) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    try {
      if (cells.length < header.length) throw new Error(`expected ${header.length} columns, got ${cells.length}`);
      const bankReference = normalizeBankReference(get(iRef));
      if (!bankReference) throw new Error('missing reference');
      const cr = parseInrAmount(get(iCr));
      const dr = iDr >= 0 ? parseInrAmount(get(iDr)) : null;
      const hasCr = cr !== null && cr > 0;
      const hasDr = dr !== null && dr > 0;
      if (hasCr && hasDr) throw new Error('both credit and debit are set');
      if (!hasCr && !hasDr) throw new Error('no non-zero credit or debit amount');
      const rawDate = get(iValue) || get(iDate);
      if (!rawDate) throw new Error('missing date');
      const valueAt = parseStatementDate(rawDate, mapping.dateFormat);
      const canonical = JSON.stringify(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
      rows.push({
        direction: hasCr ? 'CREDIT' : 'DEBIT',
        amountPaise: (hasCr ? cr : dr) as number,
        currency: 'INR',
        bankReference,
        valueAt,
        narrationRedacted: iNarr >= 0 ? redactNarration(get(iNarr)) : null,
        counterpartyMasked: null,
        sourceRowHash: createHash('sha256').update(canonical).digest('hex'),
      });
    } catch (e) {
      rejected.push({ line, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { rows, rejected };
}
