/**
 * /qr/[code] — entry point for QR scans. Resolves the code to a storefront
 * URL and redirects. Phase 1 has no customer app, so this is how customers
 * arrive at the menu after scanning a table tent or campaign poster.
 */
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function QrScanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  let qr;
  try {
    qr = await prisma.qrCode.update({
      where: { code },
      data: { scanCount: { increment: 1 } },
      include: { restaurant: { select: { slug: true, status: true } } }
    });
  } catch {
    notFound();
  }

  if (!qr.isActive || qr.restaurant.status !== 'ACTIVE') notFound();
  redirect(`/r/${qr.restaurant.slug}?qr=${encodeURIComponent(qr.code)}`);
}
