import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from './db';
import { money } from '@/lib/utils';
import { formatIst } from '@/lib/ist';
import { itemLabel } from '@/lib/kot';
import { csvLine } from './reports/csv';

/** Rows fetched per round-trip when exporting orders (keeps memory flat). */
export const EXPORT_BATCH = 1000;
/** XLSX is built in memory, so it is capped; CSV streams without a cap. */
export const XLSX_MAX_ROWS = 50_000;

export interface ExportRange { from: Date; to: Date }

const EXPORT_SELECT = {
  id: true,
  code: true,
  placedAt: true,
  status: true,
  total: true,
  paymentMethod: true,
  customer: { select: { name: true, phone: true } },
} as const;

/** Keyset-paginated walk over the scoped orders, newest first, EXPORT_BATCH at a time. */
async function* orderBatches<T extends Record<string, unknown>>(branchIds: string[], range: ExportRange, select: T) {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.order.findMany({
      where: { branchId: { in: branchIds }, placedAt: { gte: range.from, lte: range.to } },
      select: { ...select, id: true },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) return;
    yield batch as any[];
    if (batch.length < EXPORT_BATCH) return;
    cursor = (batch[batch.length - 1] as { id: string }).id;
  }
}

/**
 * Streams the order export as CSV (BOM + header + one line per order), bounded
 * by `range` and fetched in batches, with formula-safe escaping (csvLine).
 */
export function ordersCsvStream(branchIds: string[], range: ExportRange): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = orderBatches(branchIds, range, EXPORT_SELECT);
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(enc.encode('\uFEFF' + csvLine(['code', 'placed_at_ist', 'status', 'customer', 'total', 'payment_method']) + '\n'));
        return;
      }
      const next = await it.next();
      if (next.done) { controller.close(); return; }
      const lines = next.value.map((o) =>
        csvLine([o.code, formatIst(o.placedAt, IST_STAMP), o.status, o.customer.name ?? o.customer.phone ?? '', Number(o.total).toFixed(2), o.paymentMethod]),
      );
      controller.enqueue(enc.encode(lines.join('\n') + '\n'));
    },
    async cancel() { await it.return(undefined); },
  });
}

/** Thrown when an XLSX export would exceed XLSX_MAX_ROWS. */
export class ExportTooLargeError extends Error {}

export async function ordersToXlsx(branchIds: string[], range: ExportRange): Promise<Buffer> {
  const total = await prisma.order.count({ where: { branchId: { in: branchIds }, placedAt: { gte: range.from, lte: range.to } } });
  if (total > XLSX_MAX_ROWS) throw new ExportTooLargeError(`That range has ${total} orders — pick a shorter range or download CSV.`);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurant Manager';
  const ws = wb.addWorksheet('Orders');
  ws.columns = [
    { header: 'Code', key: 'code', width: 14 },
    { header: 'Placed (IST)', key: 'placed', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Customer', key: 'customer', width: 22 },
    { header: 'Items', key: 'items', width: 50 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Payment', key: 'payment', width: 12 }
  ];
  ws.getRow(1).font = { bold: true };
  for await (const batch of orderBatches(branchIds, range, { ...EXPORT_SELECT, items: { select: { quantity: true, name: true, selectedVariantName: true, modifiersSummary: true } } })) {
    for (const o of batch) {
      ws.addRow({
        code: o.code,
        placed: formatIst(o.placedAt, IST_STAMP),
        status: o.status,
        customer: o.customer.name ?? o.customer.phone ?? '',
        items: o.items.map((i: { quantity: number; name: string }) => `${i.quantity}× ${itemLabel(i)}`).join(', '),
        total: Number(o.total),
        payment: o.paymentMethod
      });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const IST_STAMP: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

export async function invoicePdf(orderId: string): Promise<Buffer> {
  const o = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, customer: true, address: true, branch: true, payments: true }
  });
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  doc.fontSize(20).text(o.branch.name, { continued: false });
  doc.fontSize(10).fillColor('#666').text(`${o.branch.line1}, ${o.branch.city} ${o.branch.postalCode}`);
  doc.moveDown();
  doc.fillColor('#000').fontSize(14).text(`Invoice — ${o.code}`);
  doc.fontSize(10).fillColor('#666').text(`Placed: ${formatIst(o.placedAt)}`);
  doc.moveDown();
  doc.fillColor('#000').fontSize(11).text(`Customer: ${o.customer.name ?? ''}  ${o.customer.phone ?? ''}`);
  if (o.address) doc.text(`Deliver to: ${o.address.line1}, ${o.address.city} ${o.address.postalCode}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').text('Item', 50, doc.y, { continued: true, width: 280 });
  doc.text('Qty', { continued: true, width: 60, align: 'right' });
  doc.text('Price', { continued: true, width: 80, align: 'right' });
  doc.text('Amount', { width: 80, align: 'right' });
  doc.font('Helvetica');
  for (const i of o.items) {
    doc.text(itemLabel(i) + (i.isFreebie ? ' (free gift)' : ''), 50, doc.y, { continued: true, width: 280 });
    doc.text(String(i.quantity), { continued: true, width: 60, align: 'right' });
    doc.text(money(i.unitPrice as any), { continued: true, width: 80, align: 'right' });
    doc.text(money(Number(i.unitPrice) * i.quantity), { width: 80, align: 'right' });
  }
  doc.moveDown();
  const right = (label: string, value: string) => {
    doc.text(label, 350, doc.y, { continued: true, width: 100, align: 'right' });
    doc.text(value, { width: 100, align: 'right' });
  };
  right('Subtotal', money(o.subtotal as any));
  right('Tax', money(o.taxAmount as any));
  right('Delivery', money(o.deliveryFee as any));
  if (Number(o.discountAmount) > 0) right('Discount', '−' + money(o.discountAmount as any));
  if (Number(o.walletApplied) > 0) right('Wallet', '−' + money(o.walletApplied as any));
  if (Number(o.loyaltyApplied) > 0) right('Loyalty', '−' + money(o.loyaltyApplied as any));
  doc.font('Helvetica-Bold');
  right('Total', money(o.total as any));
  doc.font('Helvetica');
  doc.moveDown();
  doc.fontSize(10).fillColor('#666').text(`Payment: ${o.paymentMethod}`);

  doc.end();
  return done;
}
