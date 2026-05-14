/**
 * Common helpers for report endpoints: parse `?from`, `?to`, `?format=csv|xlsx`,
 * and pick the helper based on `format`. Defaults: last 30 days, format=csv.
 */

import { csvResponse } from './csv';
import { xlsxResponse } from './xlsx';

export type ReportFormat = 'csv' | 'xlsx';

export function parseRange(url: URL): { from: Date; to: Date; format: ReportFormat } {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  const from = fromRaw ? new Date(fromRaw) : defaultFrom;
  const to = toRaw ? new Date(toRaw) : now;
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Response('Invalid date', { status: 400 });
  }
  // Inclusive end-of-day if caller passed a date-only string.
  if (toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    to.setHours(23, 59, 59, 999);
  }
  const fmtParam = (url.searchParams.get('format') ?? 'csv').toLowerCase();
  const format: ReportFormat = fmtParam === 'xlsx' ? 'xlsx' : 'csv';
  return { from, to, format };
}

export async function deliverReport(opts: {
  format: ReportFormat;
  headers: string[];
  rows: unknown[][];
  basename: string;
}): Promise<Response> {
  const ext = opts.format === 'xlsx' ? 'xlsx' : 'csv';
  const filename = `${opts.basename}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  if (opts.format === 'xlsx') {
    return xlsxResponse({ headers: opts.headers, rows: opts.rows, filename });
  }
  return csvResponse({ headers: opts.headers, rows: opts.rows, filename });
}
