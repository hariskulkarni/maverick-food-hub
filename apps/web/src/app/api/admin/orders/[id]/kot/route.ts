import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { itemOptions, FULFILLMENT_LABEL } from '@/lib/kot';
import { formatIst } from '@/lib/ist';
import { requireOrderAdminScope, orderScopeWhere } from '../../_helpers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + tenant ownership (scoped find, fail closed).
  const scope = await requireOrderAdminScope();
  if ('error' in scope) return scope.error;
  const o = await prisma.order.findFirst({
    where: orderScopeWhere(id, scope.scopeRestaurantId),
    include: {
      items: { include: { combo: { include: { items: { include: { menuItem: { select: { name: true } } } } } } } },
      branch: { select: { name: true } },
      reservation: { select: { table: { select: { name: true } } } },
    },
  });
  if (!o) return Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 });
  // Plain HTML KOT, auto-print on load. P1-10: every line carries its variant,
  // modifiers, line note, combo constituents and a FREE GIFT tag.
  const rows = o.items.map((i) => {
    const opts = itemOptions(i);
    const combo = i.combo
      ? i.combo.items.map((ci) => `<div class="sub">↳ ${escape(ci.menuItem?.name ?? 'Item')} ×${ci.quantity * i.quantity}</div>`).join('')
      : '';
    return `<tr><td>${i.quantity}</td><td>${escape(i.name)}${i.isFreebie ? ' <strong>[FREE GIFT]</strong>' : ''}`
      + (opts ? `<div class="opt">${escape(opts)}</div>` : '')
      + combo
      + (i.notes ? `<div class="note">Note: ${escape(i.notes)}</div>` : '')
      + `</td></tr>`;
  }).join('');
  const service = [
    FULFILLMENT_LABEL[o.fulfillmentType] ?? o.fulfillmentType,
    o.reservation?.table?.name ? `Table ${o.reservation.table.name}` : null,
    o.scheduledFor ? `Scheduled ${formatIst(o.scheduledFor, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : null,
  ].filter(Boolean).join(' · ');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>KOT ${o.code}</title>
<style>
  body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:300px;margin:8px auto;padding:8px;color:#000}
  h1{font-size:16px;text-align:center;margin:0 0 8px}
  .meta{font-size:12px;text-align:center;color:#444}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  td{padding:4px 0;vertical-align:top;border-bottom:1px dashed #ccc}
  td:first-child{width:30px;font-weight:700}
  .opt{font-size:13px;font-weight:700}
  .sub{font-size:12px;color:#333;padding-left:8px}
  .note{font-size:12px;color:#000;font-style:italic}
  .svc{font-size:14px;text-align:center;font-weight:700;margin-top:4px}
  .footer{font-size:11px;text-align:center;margin-top:12px;color:#777}
  @media print{ body{margin:0} }
</style></head>
<body onload="window.print()">
  <h1>KOT</h1>
  <div class="meta">${escape(o.branch.name)}</div>
  <div class="meta">${o.code} · ${escape(formatIst(o.placedAt))}</div>
  <div class="svc">${escape(service)}</div>
  <table>${rows}</table>
  ${o.customerNotes ? `<p style="font-size:12px;margin-top:8px"><strong>Notes:</strong> ${escape(o.customerNotes)}</p>` : ''}
  <div class="footer">— end of ticket —</div>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escape(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
