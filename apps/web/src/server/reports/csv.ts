/**
 * CSV helper for report endpoints.
 *
 * Tiny — no streaming, fine for the volumes we generate.
 * Returns a Next-friendly Response with the right headers so the
 * browser downloads the file.
 */

function escape(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  const s = typeof cell === 'string' ? cell : String(cell);
  // Quote if it contains separator, quote or newline.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvResponse(opts: {
  headers: string[];
  rows: unknown[][];
  filename: string;
}): Response {
  const lines: string[] = [];
  lines.push(opts.headers.map(escape).join(','));
  for (const row of opts.rows) lines.push(row.map(escape).join(','));
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
