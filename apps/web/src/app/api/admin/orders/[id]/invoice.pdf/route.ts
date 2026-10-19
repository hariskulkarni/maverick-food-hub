import { NextRequest } from 'next/server';
import { invoicePdf } from '@/server/exports';
import { requireOwnedOrder } from '../../_helpers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + tenant ownership before emitting the invoice.
  const scope = await requireOwnedOrder(id);
  if ('error' in scope) return scope.error;
  const buf = await invoicePdf(id);
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="invoice-${id}.pdf"` } });
}
