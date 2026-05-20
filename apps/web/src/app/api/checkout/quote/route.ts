import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { pricing } from '@/server/pricing';

const Body = z.object({
  branchId: z.string(),
  addressId: z.string().optional(),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP', 'DINE_IN']).optional(),
  items: z.array(z.object({ menuItemId: z.string().optional(), comboId: z.string().optional(), quantity: z.number().int().positive() })),
  couponCode: z.string().optional(),
  walletApply: z.number().nonnegative().optional(),
  loyaltyApply: z.number().nonnegative().optional()
});

export async function POST(req: NextRequest) {
  const body = Body.parse(await req.json());
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: body.branchId } });
  const address = body.addressId ? await prisma.address.findUnique({ where: { id: body.addressId } }) : null;

  const lines: { unitPrice: number; quantity: number }[] = [];
  for (const it of body.items) {
    if (it.menuItemId) {
      const m = await prisma.menuItem.findUnique({ where: { id: it.menuItemId } });
      if (m) lines.push({ unitPrice: Number(m.price), quantity: it.quantity });
    } else if (it.comboId) {
      const c = await prisma.combo.findUnique({ where: { id: it.comboId } });
      if (c) lines.push({ unitPrice: Number(c.price), quantity: it.quantity });
    }
  }

  let coupon = null as null | { flatOff?: number | null; percentOff?: number | null; minOrderAmount?: number | null; maxDiscount?: number | null };
  if (body.couponCode) {
    const c = await prisma.coupon.findUnique({ where: { code: body.couponCode } });
    if (c && c.isActive) {
      coupon = {
        flatOff: c.flatOff ? Number(c.flatOff) : null,
        percentOff: c.percentOff,
        minOrderAmount: c.minOrderAmount ? Number(c.minOrderAmount) : null,
        maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null
      };
    }
  }

  const r = pricing({
    lines,
    taxRatePct: branch.taxRatePct,
    baseDeliveryFee: Number(branch.baseDeliveryFee),
    perKmDeliveryFee: Number(branch.perKmDeliveryFee),
    // Packaging applies to delivery + pickup but not dine-in (served at table).
    packagingFee: body.fulfillmentType === 'DINE_IN' ? 0 : Number(branch.packagingFee),
    branch: { lat: branch.latitude, lng: branch.longitude },
    delivery: address ? { lat: address.latitude, lng: address.longitude } : null,
    coupon,
    walletApplied: body.walletApply,
    loyaltyApplied: body.loyaltyApply
  });
  return Response.json({ ...r, taxRatePct: branch.taxRatePct });
}
