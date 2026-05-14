import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { invoicePdf } from '@/server/exports';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!['ADMIN', 'KITCHEN'].includes(session?.user.role || '')) return new Response('Forbidden', { status: 403 });
  const buf = await invoicePdf(id);
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="invoice-${id}.pdf"` } });
}
