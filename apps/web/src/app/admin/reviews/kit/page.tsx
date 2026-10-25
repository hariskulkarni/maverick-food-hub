/**
 * /admin/reviews/kit — printable review QR kit: A5 table tent + A6 packaging
 * insert with the restaurant's branding and compliant copy (no incentives).
 * The QR is a REVIEW-type QrCode: /qr/<code> counts the scan and opens a
 * tracked feedback page where the Google button is shown at every rating.
 */
import { requireRestaurant } from '@/server/tenancy';
import { ensureReviewQr } from '@/server/qr';
import { qrPngDataUrl, qrScanUrl } from '@/server/qr-image';
import { KitClient } from './kit-client';

export const metadata = { title: 'Admin · Review QR kit' };
export const dynamic = 'force-dynamic';

export default async function ReviewKitPage() {
  const restaurant = await requireRestaurant();
  const { qr } = await ensureReviewQr(restaurant.id);
  const url = qrScanUrl(qr.code);
  const qrPng = await qrPngDataUrl(url, 900);
  return (
    <KitClient
      restaurant={{ name: restaurant.name, logoUrl: restaurant.logoUrl, tagline: restaurant.tagline }}
      qr={{ code: qr.code, url, png: qrPng, scanCount: qr.scanCount }}
    />
  );
}
