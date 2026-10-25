/**
 * Common helpers for report endpoints: parse `?from`, `?to`, `?format=csv|xlsx`,
 * and pick the helper based on `format`. Defaults: last 30 IST days, format=csv.
 */

import { csvResponse } from './csv';
import { xlsxResponse } from './xlsx';
import { istDayKey, istStartOfDay, istEndOfDay, addDaysToKey, isDayKey } from '@/lib/ist';

export type ReportFormat = 'csv' | 'xlsx';

/** Longest range a report/export may span — bounds memory + query time. */
export const MAX_RANGE_DAYS = 366;

/**
 * Date-only `from`/`to` are IST calendar days (restaurants run on IST), so
 * from = 00:00 IST and to = 23:59:59.999 IST regardless of the server's zone.
 * Throws a 400 Response on an invalid, inverted or over-long range.
 */
export function parseRange(url: URL): { from: Date; to: Date; format: ReportFormat } {
  const now = new Date();
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  const from = !fromRaw ? istStartOfDay(addDaysToKey(istDayKey(now), -30))
    : isDayKey(fromRaw) ? istStartOfDay(fromRaw) : new Date(fromRaw);
  const to = !toRaw ? now
    : isDayKey(toRaw) ? istEndOfDay(toRaw) : new Date(toRaw);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Response('Invalid date', { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    throw new Response('The start date is after the end date', { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Response(`Pick a range of at most ${MAX_RANGE_DAYS} days`, { status: 400 });
  }
  const fmtParam = (url.searchParams.get('format') ?? 'csv').toLowerCase();
  const format: ReportFormat = fmtParam === 'xlsx' ? 'xlsx' : 'csv';
  return { from, to, format };
}

/**
 * Wrap a report GET so a thrown Response (auth gate, bad range) is returned
 * as-is instead of surfacing as a 500.
 */
export function reportRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  };
}

export async function deliverReport(opts: {
  format: ReportFormat;
  headers: string[];
  rows: unknown[][];
  basename: string;
}): Promise<Response> {
  const ext = opts.format === 'xlsx' ? 'xlsx' : 'csv';
  const filename = `${opts.basename}-${istDayKey()}.${ext}`;
  if (opts.format === 'xlsx') {
    return xlsxResponse({ headers: opts.headers, rows: opts.rows, filename });
  }
  return csvResponse({ headers: opts.headers, rows: opts.rows, filename });
}
