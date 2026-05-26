import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from './db';
import { money } from '@/lib/utils';

export async function ordersToCsv(branchId: string | string[], opts: { from?: Date; to?: Date } = {}): Promise<string> {
  const branchWhere = Array.isArray(branchId) ? { in: branchId } : branchId;
  const orders = await prisma.order.findMany({
    where: { branchId: branchWhere, placedAt: { gte: opts.from, lte: opts.to } },
    include: { customer: true },
    orderBy: { placedAt: 'desc' }
  });
  const lines = ['code,placed_at,status,customer,total,payment_method'];
  for (const o of orders) {
    lines.push([o.code, o.placedAt.toISOString(), o.status, o.customer.name ?? o.customer.phone ?? '', Number(o.total), o.paymentMethod].join(','));
  }
  return lines.join('\n');
}

export async function ordersToXlsx(branchId: string | string[], opts: { from?: Date; to?: Date } = {}): Promise<Buffer> {
  const branchWhere = Array.isArray(branchId) ? { in: branchId } : branchId;
  const orders = await prisma.order.findMany({
    where: { branchId: branchWhere, placedAt: { gte: opts.from, lte: opts.to } },
    include: { customer: true, items: true },
    orderBy: { placedAt: 'desc' }
  });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurant Manager';
  const ws = wb.addWorksheet('Orders');
  ws.columns = [
    { header: 'Code', key: 'code', width: 14 },
    { header: 'Placed', key: 'placed', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Customer', key: 'customer', width: 22 },
    { header: 'Items', key: 'items', width: 50 },
    { header: 'Total', key: 'total', width: 12 },
    { header: 'Payment', key: 'payment', width: 12 }
  ];
  ws.getRow(1).font = { bold: true };
  for (const o of orders) {
    ws.addRow({
      code: o.code,
      placed: o.placedAt.toISOString(),
      status: o.status,
      customer: o.customer.name ?? o.customer.phone ?? '',
      items: o.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
      total: Number(o.total),
      payment: o.paymentMethod
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

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
  doc.fontSize(10).fillColor('#666').text(`Placed: ${o.placedAt.toLocaleString('en-IN')}`);
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
    doc.text(i.name, 50, doc.y, { continued: true, width: 280 });
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
