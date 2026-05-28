/**
 * QR helpers — shared by every code-path that creates a QR.
 *
 *   • mintQrCode(...)      — collision-safe single QR creator (8-char nanoid)
 *   • ensureRestaurantQr() — idempotent "this restaurant has at least one
 *                            RESTAURANT-type QR" guarantee, used by the platform
 *                            QR page's "Generate missing" sweep AND by the
 *                            restaurant-create wizard.
 */
import 'server-only';
import { customAlphabet } from 'nanoid';
import { prisma } from '@/server/db';
import type { QrType } from '@prisma/client';

const nano = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/** Lower-level: mint a QR row with collision retries (up to 5). */
export async function mintQrCode(opts: {
  restaurantId: string;
  type: QrType;
  branchId?: string | null;
  tableId?: string | null;
  campaignName?: string | null;
}) {
  for (let i = 0; i < 5; i++) {
    const code = nano();
    try {
      return await prisma.qrCode.create({
        data: {
          code,
          restaurantId: opts.restaurantId,
          type: opts.type,
          branchId: opts.branchId ?? null,
          tableId: opts.tableId ?? null,
          campaignName: opts.campaignName ?? null,
        },
      });
    } catch {
      // unique-constraint collision — retry with a fresh code
    }
  }
  throw new Error('Failed to mint a unique QR code after 5 attempts');
}

/**
 * Ensure a restaurant has at least one active RESTAURANT-scope QR.
 *
 * Returns { qr, created } so callers can report what happened (the "Generate
 * missing" sweep on the platform QR page uses `created` to count + toast).
 */
export async function ensureRestaurantQr(restaurantId: string) {
  const existing = await prisma.qrCode.findFirst({
    where: { restaurantId, type: 'RESTAURANT', branchId: null, tableId: null, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { qr: existing, created: false as const };
  const qr = await mintQrCode({ restaurantId, type: 'RESTAURANT' });
  return { qr, created: true as const };
}
