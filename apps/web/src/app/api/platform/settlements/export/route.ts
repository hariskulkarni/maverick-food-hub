/**
 * GET /api/platform/settlements/export?restaurantId=&from=&to=
 * Multi-sheet xlsx settlement report (Summary · Payout Breakup · Order Level ·
 * Discounts Summary · Tax) — the downloadable file partners expect. Super-admin.
 */
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { requireSuperAdmin } from '@/server/tenancy';
import { buildSettlementReport } from '@/server/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INR = '₹#,##0.00;[Red]-₹#,##0.00;"-"';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF23E5C' } };

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const sp = new URL(req.url).searchParams;
  const restaurantId = sp.get('restaurantId') ?? '';
  if (!restaurantId) return new Response('restaurantId required', { status: 400 });
  const now = new Date();
  const to = sp.get('to') ? new Date(sp.get('to')! + 'T23:59:59') : now;
  const from = sp.get('from') ? new Date(sp.get('from')! + 'T00:00:00') : new Date(to.getTime() - 6 * 86400000);

  const rep = await buildSettlementReport(restaurantId, from, to);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Flavrly Settlement Engine';

  const headerRow = (ws: ExcelJS.Worksheet, rowIdx: number, n: number) => {
    const row = ws.getRow(rowIdx);
    for (let c = 1; c <= n; c++) { const cell = row.getCell(c); cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = HEADER_FILL; }
  };

  // Summary
  const s = wb.addWorksheet('Summary');
  s.getCell('A1').value = 'FLAVRLY — Partner Settlement Report'; s.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFF23E5C' } };
  const meta: [string, string | number | null][] = [
    ['Restaurant', rep.restaurant.name], ['Legal entity', rep.restaurant.legalName], ['GSTIN', rep.restaurant.gstin],
    ['PAN', rep.restaurant.pan], ['Bank (masked)', rep.restaurant.bankAccountLast4 ? 'XXXX' + rep.restaurant.bankAccountLast4 : null],
    ['Settlement cycle', rep.restaurant.settlementCycle], ['Commission %', rep.restaurant.commissionPct],
    ['Period', `${rep.period.from} to ${rep.period.to}`],
    ['Delivered orders', rep.summary.deliveredOrders], ['Cancelled orders', rep.summary.cancelledOrders],
    ['Net order value', rep.summary.netOrderValue], ['Net deductions', rep.summary.netDeductions],
    ['Net additions', rep.summary.netAdditions], ['Net payout', rep.summary.netPayout],
  ];
  let r = 3;
  for (const [k, v] of meta) { s.getCell(`A${r}`).value = k; s.getCell(`A${r}`).font = { bold: true }; s.getCell(`B${r}`).value = v as ExcelJS.CellValue; r++; }
  s.getColumn(1).width = 22; s.getColumn(2).width = 30;

  // Payout Breakup
  const pb = wb.addWorksheet('Payout Breakup');
  pb.addRow(['S.no', 'Particular', 'Delivered', 'Cancelled', 'Total']); headerRow(pb, 1, 5);
  for (const b of rep.payoutBreakup) {
    const row = pb.addRow([b.sno, b.particular, b.delivered, b.cancelled, b.total]);
    for (const c of [3, 4, 5]) row.getCell(c).numFmt = INR;
    if (['A', 'B', 'C', 'D', 'E'].includes(b.sno)) row.font = { bold: true };
  }
  pb.getColumn(2).width = 38; [3, 4, 5].forEach((c) => (pb.getColumn(c).width = 16));

  // Order Level
  const ol = wb.addWorksheet('Order Level');
  const olHeads = ['S.no', 'Order ID', 'Date', 'Status', 'Payment', 'Fulfillment', 'Discount construct',
    'Subtotal', 'Packaging', 'Delivery', 'Promo disc', 'Bonus disc', 'GST collected', 'Net order value (A)',
    'Commissionable', 'Commission %', 'Commission', 'Payment fee', 'GST on fee', 'TCS', 'TDS', 'Govt charges',
    'Net deductions (C)', 'Net additions (D)', 'Payout (E)'];
  ol.addRow(olHeads); headerRow(ol, 1, olHeads.length);
  rep.lines.forEach((l, i) => {
    const row = ol.addRow([i + 1, l.code, l.date, l.status, l.paymentMethod, l.fulfillmentType, l.discountConstruct,
      l.subtotal, l.packaging, l.delivery, l.discountPromo, l.discountBonus, l.gstCollected, l.netOrderValue,
      l.commissionableValue, l.commissionPct, l.commission, l.paymentFee, l.gstOnFee, l.tcs, l.tds, l.govtCharges,
      l.netDeductions, l.netAdditions, l.payout]);
    for (let c = 8; c <= 25; c++) if (c !== 16) row.getCell(c).numFmt = INR;
  });
  ol.columns.forEach((c, i) => (c.width = i < 7 ? 16 : 13));
  ol.views = [{ state: 'frozen', ySplit: 1 }];

  // Discounts Summary
  const ds = wb.addWorksheet('Discounts Summary');
  ds.addRow(['Discount construct', 'Orders', 'Subtotal', 'Discount given', 'Discount/order', 'Effective %']); headerRow(ds, 1, 6);
  for (const d of rep.discountsSummary) {
    const row = ds.addRow([d.construct, d.orders, d.subtotal, d.discountGiven, d.discountPerOrder, d.effectivePct / 100]);
    [3, 4, 5].forEach((c) => (row.getCell(c).numFmt = INR)); row.getCell(6).numFmt = '0.0%';
  }
  ds.getColumn(1).width = 22; [2, 3, 4, 5, 6].forEach((c) => (ds.getColumn(c).width = 15));

  // Tax
  const tx = wb.addWorksheet('Tax & Compliance');
  tx.addRow(['Component', 'Basis', 'Rate', 'Period total']); headerRow(tx, 1, 4);
  for (const t of rep.tax) { const row = tx.addRow([t.component, t.basis, t.rate, t.total]); row.getCell(4).numFmt = INR; }
  tx.getColumn(1).width = 32; tx.getColumn(2).width = 28; tx.getColumn(3).width = 16; tx.getColumn(4).width = 16;

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const fname = `Flavrly-Settlement_${rep.restaurant.name.replace(/[^a-z0-9]+/gi, '-')}_${rep.period.from}_${rep.period.to}.xlsx`;
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
}
