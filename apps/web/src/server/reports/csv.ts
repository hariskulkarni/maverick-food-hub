/**
 * CSV helper for report endpoints.
 *
 * Aggregated reports are small (one row per day/item), so no streaming here;
 * the raw order export streams via src/server/exports.ts.
 * Returns a Next-friendly Response with the right headers so the
 * browser downloads the file.
 */

/**
 * One CSV cell. Quotes separators/quotes/newlines, and neutralises spreadsheet
 * formula injection: a TEXT cell starting with = + - @ (or tab/CR) gets a
 * leading ' so Excel/Sheets show it as text instead of evaluating it. Plain
 * numbers (incl. negatives) are left alone.
 */
export function csvCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  let s = typeof cell === 'string' ? cell : String(cell);
  if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  // Quote if it contains separator, quote or newline.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One CSV line (no trailing newline). */
export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function csvResponse(opts: {
  headers: string[];
  rows: unknown[][];
  filename: string;
}): Response {
  const lines: string[] = [];
  lines.push(csvLine(opts.headers));
  for (const row of opts.rows) lines.push(csvLine(row));
  // BOM so Excel opens with UTF-8 correctly.
  const body = '﻿' + lines.join('\n');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${opts.filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
