import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!['ADMIN', 'KITCHEN'].includes(session?.user.role || '')) return new Response('Forbidden', { status: 403 });
  const o = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true, branch: true } });
  // Plain HTML KOT, auto-print on load
  const rows = o.items.map((i) => `<tr><td>${i.quantity}</td><td>${escape(i.name)}${i.notes ? `<div style="font-size:12px;color:#555">${escape(i.notes)}</div>` : ''}</td></tr>`).join('');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>KOT ${o.code}</title>
<style>
  body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:300px;margin:8px auto;padding:8px;color:#000}
  h1{font-size:16px;text-align:center;margin:0 0 8px}
  .meta{font-size:12px;text-align:center;color:#444}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}
  td{padding:4px 0;vertical-align:top;border-bottom:1px dashed #ccc}
  td:first-child{width:30px;font-weight:700}
  .footer{font-size:11px;text-align:center;margin-top:12px;color:#777}
  @media print{ body{margin:0} }
</style></head>
<body onload="window.print()">
  <h1>KOT</h1>
  <div class="meta">${escape(o.branch.name)}</div>
  <div class="meta">${o.code} · ${new Date(o.placedAt).toLocaleString('en-IN')}</div>
  <table>${rows}</table>
  ${o.customerNotes ? `<p style="font-size:12px;margin-top:8px"><strong>Notes:</strong> ${escape(o.customerNotes)}</p>` : ''}
  <div class="footer">— end of ticket —</div>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function escape(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
