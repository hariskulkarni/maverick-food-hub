/**
 * XLSX helper for report endpoints — wraps exceljs into a tiny
 * "headers + rows + filename" interface.
 */

import ExcelJS from 'exceljs';

export async function xlsxResponse(opts: {
  headers: string[];
  rows: unknown[][];
  filename: string;
  sheetName?: string;
}): Promise<Response> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurant Manager';
  const sheet = wb.addWorksheet(opts.sheetName ?? 'Report');
  sheet.addRow(opts.headers);
  sheet.getRow(1).font = { bold: true };
  for (const r of opts.rows) {
    sheet.addRow(
      r.map((cell) => {
        if (cell instanceof Date) return cell.toISOString();
        if (cell === undefined || cell === null) return '';
        return cell as ExcelJS.CellValue;
      })
    );
  }
  // Best-effort auto-width.
  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value == null ? '' : String(cell.value);
      if (v.length > max) max = Math.min(v.length + 2, 50);
    });
    col.width = max;
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${opts.filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
