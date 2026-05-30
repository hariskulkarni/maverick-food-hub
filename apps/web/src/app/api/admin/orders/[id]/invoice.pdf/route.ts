import { NextRequest } from 'next/server';
import { invoicePdf } from '@/server/exports';
import { requireAnyAdminApi } from '@/server/api-auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAnyAdminApi();
  if (gate instanceof Response) return gate;
  const buf = await invoicePdf(id);
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="invoice-${id}.pdf"` } });
}
