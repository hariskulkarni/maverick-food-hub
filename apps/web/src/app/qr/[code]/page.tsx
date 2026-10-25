/**
 * /qr/[code] — entry point for QR scans. Resolves the code to a storefront
 * URL and redirects. Phase 1 has no customer app, so this is how customers
 * arrive at the menu after scanning a table tent or campaign poster.
 */
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/server/db';
import { newToken } from '@/server/reviews/acquisition';
import { rateLimit } from '@/server/http/rate-limit';

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
  if (qr.type === 'REVIEW') {
    // Review kit: each scan gets its own tracked feedback link (funnel + Google
    // click counting). Rate-limited per IP so a scripted loop can't flood rows.
    const rl = await rateLimit(new Request('http://qr.local', { headers: await headers() }), {
      name: 'qr-review-scan', limit: 20, windowMs: 60_000,
    });
    if (!rl.ok) redirect(`/r/${qr.restaurant.slug}`);
    const token = newToken();
    await prisma.reviewRequest.create({
      data: {
        restaurantId: qr.restaurantId, qrCodeId: qr.id, channel: 'QR', token,
        status: 'CLICKED', clickedAt: new Date()
      }
    });
    redirect(`/feedback/${token}`);
  }
  redirect(`/r/${qr.restaurant.slug}?qr=${encodeURIComponent(qr.code)}`);
}
