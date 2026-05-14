import { prisma } from '@/server/db';
import { CartClient } from './cart-client';

export const metadata = { title: 'Cart' };

export default async function CartPage() {
  // Resolve the active branch for offer + cross-sell APIs. The cart context
  // itself doesn't track which branch the customer is ordering from — we
  // default to the first active branch, matching the checkout page pattern.
  const branch = await prisma.branch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  return <CartClient branchId={branch?.id ?? null} />;
}
