/**
 * Freebie/gift engine.
 *
 * A FreebieRule says "spend ≥ ₹X, get item Y free". When an order's qualifying
 * amount (subtotal) clears a rule's threshold AND the rule has stock, the gift
 * is added to the order as a ₹0 OrderItem (isFreebie=true) and the rule's stock
 * is atomically decremented. Admin can later remove/swap the freebie, which
 * restores the stock.
 *
 * Selection: when multiple rules qualify, the customer earns the BEST one —
 * the highest-threshold rule they cleared (a ₹999 order earns the ₹799-tier
 * gift, not the ₹399 one). Ties broken by sortOrder then most-recently-created.
 *
 * Gated by Restaurant.allowFreebies — callers check that before invoking.
 *
 * IMPORTANT: grant happens INSIDE the order-create transaction (see
 * placeOrder) so two concurrent qualifying orders can't both claim the last
 * unit of stock. `resolveQualifyingFreebie` is the read-only selection step;
 * `grantFreebieTx` does the atomic decrement + returns the line to insert.
 */

import { prisma } from './db';
import { Prisma, PrismaClient } from '@prisma/client';

export interface QualifyingFreebie {
  ruleId: string;
  ruleName: string;
  menuItemId: string;
  itemName: string;
  /** Stock remaining BEFORE this grant (for display/logging). */
  stockBefore: number;
}

/**
 * Pick the best freebie rule a given subtotal qualifies for at a branch.
 * Read-only — does NOT decrement stock. Returns null when freebies are off,
 * no rule qualifies, or every qualifying rule is out of stock.
 *
 * `allowFreebies` is passed in (the caller already loaded the restaurant) to
 * avoid a redundant query; pass false to short-circuit.
 */
export async function resolveQualifyingFreebie(
  branchId: string,
  subtotal: number,
  allowFreebies: boolean
): Promise<QualifyingFreebie | null> {
  if (!allowFreebies) return null;

  const rules = await prisma.freebieRule.findMany({
    where: {
      branchId,
      isActive: true,
      stock: { gt: 0 },
      minOrderAmount: { lte: new Prisma.Decimal(subtotal) },
    },
    include: { menuItem: { select: { id: true, name: true, isAvailable: true } } },
    orderBy: [{ minOrderAmount: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
  });

  // Skip rules whose gift item is currently 86'd — can't hand out an
  // unavailable dish even if the freebie rule itself is active + in stock.
  const winner = rules.find((r) => r.menuItem.isAvailable);
  if (!winner) return null;

  return {
    ruleId: winner.id,
    ruleName: winner.name,
    menuItemId: winner.menuItemId,
    itemName: winner.menuItem.name,
    stockBefore: winner.stock,
  };
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Atomically claim one unit of a freebie rule's stock inside a transaction.
 * Uses a conditional updateMany (stock > 0) so a race that lost the last unit
 * affects 0 rows → we return null and the order simply gets no freebie. This
 * is the concurrency-safe gate; never decrement stock outside a txn.
 *
 * Returns the OrderItem create-input for the gift line, or null if the unit
 * couldn't be claimed (out of stock at commit time).
 */
export async function grantFreebieTx(
  tx: Tx,
  freebie: QualifyingFreebie
): Promise<{ menuItemId: string; name: string; quantity: number; unitPrice: Prisma.Decimal; isFreebie: true } | null> {
  const claimed = await tx.freebieRule.updateMany({
    where: { id: freebie.ruleId, stock: { gt: 0 } },
    data: { stock: { decrement: 1 }, totalGranted: { increment: 1 } },
  });
  if (claimed.count === 0) return null; // lost the race for the last unit
  return {
    menuItemId: freebie.menuItemId,
    name: freebie.itemName,
    quantity: 1,
    unitPrice: new Prisma.Decimal(0),
    isFreebie: true,
  };
}

/**
 * Restore one unit of stock to a freebie rule — used when an order that
 * received a freebie is cancelled, or when an admin removes the freebie from
 * an order before prep. Decrements totalGranted too so reporting stays honest.
 * Best-effort: a missing rule (deleted since) is a no-op.
 */
export async function restoreFreebieStock(ruleId: string): Promise<void> {
  await prisma.freebieRule
    .update({
      where: { id: ruleId },
      data: { stock: { increment: 1 }, totalGranted: { decrement: 1 } },
    })
    .catch(() => {
      /* rule deleted — nothing to restore */
    });
}
