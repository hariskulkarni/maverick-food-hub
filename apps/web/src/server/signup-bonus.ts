/**
 * Signup-bonus engine — staggered credit for new customers.
 *
 * Lifecycle:
 *   1. Sign-up → `grantSignupBonus(userId, opts)` creates a `SignupBonusGrant`
 *      with `totalAmount`, `perOrderCap`, and `remainingOrders` from the
 *      `SignupBonusConfig` singleton. Abuse checks happen here.
 *   2. Checkout → `computeSignupBonusForCart(userId, cart)` reads the grant
 *      and returns the eligible `appliedAmount` for *this* order. We DO NOT
 *      decrement the grant here — that happens once the order is committed.
 *   3. placeOrder → `holdSignupBonusForOrder(tx, userId, orderId, amount)`
 *      writes a pending hold to the grant (increments `pendingAmount`) so
 *      a second concurrent order can't re-claim the same money.
 *   4. transitionOrder(DELIVERED) → `commitSignupBonusForOrder(orderId)`
 *      moves the pending hold to `usedAmount` and decrements `remainingOrders`.
 *   5. transitionOrder(CANCELLED|REFUNDED|PAYMENT_FAILED) →
 *      `restoreSignupBonusForOrder(orderId)` releases the pending hold OR
 *      reverses a committed credit so the customer's bonus is preserved.
 *
 * Everything except the DB-aware helpers is pure and unit-tested.
 *
 * Pricing integration: the `pricing()` function gains an optional
 * `signupBonus` term. We layer the bonus on AFTER offer/coupon discounts so
 * percentage-based offers don't shrink with the bonus subtraction.
 */
import { prisma } from './db';
import { audit } from './audit';
import { clampTwo } from '@/lib/utils';

// ── Public types ─────────────────────────────────────────────────────────

export interface SignupBonusGrantLite {
  id: string;
  userId: string;
  totalAmount: number;
  perOrderCap: number;
  usedAmount: number;
  pendingAmount: number;
  remainingOrders: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface BonusApplyResult {
  appliedAmount: number;
  /** True when the grant either doesn't exist or has nothing left to spend. */
  exhausted: boolean;
  reason?: string;
  /** Snapshot for the UI display next to the cart total. */
  remainingBalance: number;
  remainingOrders: number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Compute how much bonus this grant can apply to a given cart subtotal. Does
 * NOT mutate. Caller decides whether to commit via `holdSignupBonusForOrder`.
 *
 *  - Capped at `perOrderCap` per order
 *  - Capped at remaining balance (`totalAmount - usedAmount - pendingAmount`)
 *  - Refused when no orders remain in the split window
 *  - Refused when grant is revoked or expired
 */
export function computeBonusApply(
  grant: SignupBonusGrantLite | null,
  cartSubtotal: number,
  now: Date = new Date()
): BonusApplyResult {
  if (!grant) {
    return { appliedAmount: 0, exhausted: true, reason: 'no grant', remainingBalance: 0, remainingOrders: 0 };
  }
  if (grant.revokedAt) {
    return { appliedAmount: 0, exhausted: true, reason: 'grant revoked', remainingBalance: 0, remainingOrders: 0 };
  }
  if (grant.expiresAt && now > new Date(grant.expiresAt)) {
    return { appliedAmount: 0, exhausted: true, reason: 'grant expired', remainingBalance: 0, remainingOrders: 0 };
  }
  if (grant.remainingOrders <= 0) {
    return { appliedAmount: 0, exhausted: true, reason: 'no orders remaining', remainingBalance: remainingBalance(grant), remainingOrders: 0 };
  }
  const balance = remainingBalance(grant);
  if (balance <= 0) {
    return { appliedAmount: 0, exhausted: true, reason: 'no balance remaining', remainingBalance: 0, remainingOrders: grant.remainingOrders };
  }
  // Apply min(perOrderCap, remainingBalance, cartSubtotal).
  const applied = clampTwo(Math.min(grant.perOrderCap, balance, Math.max(0, cartSubtotal)));
  return {
    appliedAmount: applied,
    exhausted: false,
    remainingBalance: clampTwo(balance),
    remainingOrders: grant.remainingOrders
  };
}

export function remainingBalance(grant: SignupBonusGrantLite): number {
  return clampTwo(Math.max(0, grant.totalAmount - grant.usedAmount - grant.pendingAmount));
}

// ── DB-aware: grant on signup ────────────────────────────────────────────

export interface GrantOpts {
  phone?: string | null;
  ipAddress?: string | null;
  deviceFingerprint?: string | null;
}

async function getActiveConfig() {
  const cfg = await (prisma as any).signupBonusConfig.findUnique({ where: { id: 'singleton' } });
  return cfg && cfg.isActive ? cfg : null;
}

/**
 * Issue a SignupBonusGrant for a freshly-created customer. Idempotent — if
 * the user already has a grant, returns the existing row instead of creating
 * a duplicate. Abuse-prevention checks:
 *   - same phone already granted? refuse
 *   - same IP already granted? refuse
 *   - same device already granted? refuse
 * Each check is gated by the corresponding flag on `SignupBonusConfig`.
 */
export async function grantSignupBonus(userId: string, opts: GrantOpts = {}) {
  const cfg = await getActiveConfig();
  if (!cfg) return null;

  // Idempotency — already granted, do nothing.
  const existing = await (prisma as any).signupBonusGrant.findUnique({ where: { userId } });
  if (existing) return existing;

  // Abuse checks
  const reasons: string[] = [];
  if (cfg.phoneCheckEnabled && opts.phone) {
    const hit = await (prisma as any).signupBonusGrant.findFirst({ where: { phoneSnapshot: opts.phone, NOT: { userId } } });
    if (hit) reasons.push('phone already received a signup bonus');
  }
  if (cfg.ipCheckEnabled && opts.ipAddress) {
    const hit = await (prisma as any).signupBonusGrant.findFirst({ where: { ipSnapshot: opts.ipAddress, NOT: { userId } } });
    if (hit) reasons.push('IP already received a signup bonus');
  }
  if (cfg.deviceCheckEnabled && opts.deviceFingerprint) {
    const hit = await (prisma as any).signupBonusGrant.findFirst({ where: { deviceSnapshot: opts.deviceFingerprint, NOT: { userId } } });
    if (hit) reasons.push('device already received a signup bonus');
  }
  if (reasons.length > 0) {
    // Log the refusal but never throw — sign-up shouldn't fail just because
    // the bonus didn't issue.
    await audit('signup_bonus.refused' as any, {
      actorId: userId, entityType: 'SignupBonusGrant', entityId: null,
      before: null, after: { reasons, ip: opts.ipAddress, phone: opts.phone }
    });
    return null;
  }

  const perOrderCap = cfg.perOrderCap != null
    ? Number(cfg.perOrderCap)
    : clampTwo(Number(cfg.totalAmount) / Math.max(1, cfg.splitCount));
  const expiresAt = cfg.validityDays > 0
    ? new Date(Date.now() + cfg.validityDays * 86_400_000)
    : null;

  const created = await (prisma as any).signupBonusGrant.create({
    data: {
      userId,
      totalAmount: cfg.totalAmount,
      perOrderCap: perOrderCap as any,
      remainingOrders: cfg.splitCount,
      phoneSnapshot: opts.phone ?? null,
      ipSnapshot: opts.ipAddress ?? null,
      deviceSnapshot: opts.deviceFingerprint ?? null,
      expiresAt
    }
  });

  await (prisma as any).signupBonusLedger.create({
    data: {
      grantId: created.id,
      orderId: null,
      kind: 'GRANT',
      delta: 0 as any,
      note: `Granted at signup — ₹${Number(cfg.totalAmount)} across ${cfg.splitCount} orders`
    }
  });

  await audit('signup_bonus.granted' as any, {
    actorId: userId, entityType: 'SignupBonusGrant', entityId: created.id,
    before: null,
    after: { totalAmount: Number(cfg.totalAmount), perOrderCap, splitCount: cfg.splitCount }
  });
  return created;
}

// ── DB-aware: cart preview ──────────────────────────────────────────────

export async function previewSignupBonusForUser(userId: string, cartSubtotal: number): Promise<BonusApplyResult> {
  const row = await (prisma as any).signupBonusGrant.findUnique({ where: { userId } });
  const grant: SignupBonusGrantLite | null = row ? rowToLite(row) : null;
  return computeBonusApply(grant, cartSubtotal);
}

function rowToLite(r: any): SignupBonusGrantLite {
  return {
    id: r.id, userId: r.userId,
    totalAmount: Number(r.totalAmount),
    perOrderCap: Number(r.perOrderCap),
    usedAmount: Number(r.usedAmount),
    pendingAmount: Number(r.pendingAmount),
    remainingOrders: r.remainingOrders,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt
  };
}

// ── DB-aware: order lifecycle hooks ─────────────────────────────────────

/**
 * Place a pending hold on the grant for an order being placed. Called inside
 * the same transaction as the Order insert so a concurrent checkout can't
 * also see the same money.
 *
 *   pendingAmount += appliedAmount
 *   no change to remainingOrders yet (that happens on DELIVERED)
 *
 * Writes a ledger entry of kind='APPLY' for traceability.
 */
export async function holdSignupBonusForOrder(
  tx: any,
  userId: string,
  orderId: string,
  appliedAmount: number
): Promise<void> {
  if (appliedAmount <= 0) return;
  const grant = await tx.signupBonusGrant.findUnique({ where: { userId } });
  if (!grant) return;
  // Re-check the math under the lock — refuse if remainingBalance shrank
  // between preview and commit (very rare race, but worth the guard).
  const balance = Number(grant.totalAmount) - Number(grant.usedAmount) - Number(grant.pendingAmount);
  if (balance < appliedAmount || grant.remainingOrders <= 0) {
    throw new Error('Signup bonus no longer available for this order');
  }
  await tx.signupBonusGrant.update({
    where: { id: grant.id },
    data: { pendingAmount: { increment: appliedAmount as any } }
  });
  await tx.signupBonusLedger.create({
    data: { grantId: grant.id, orderId, kind: 'APPLY', delta: appliedAmount as any, note: 'pending hold at checkout' }
  });
}

/**
 * Move a pending hold to a committed used-amount on DELIVERED:
 *
 *   pendingAmount -= deltaFromLedger
 *   usedAmount    += deltaFromLedger
 *   remainingOrders -= 1
 *
 * Idempotent on already-committed orders (re-fire detection via existing
 * COMMIT ledger entry).
 */
export async function commitSignupBonusForOrder(orderId: string): Promise<void> {
  const apply = await (prisma as any).signupBonusLedger.findFirst({ where: { orderId, kind: 'APPLY' } });
  if (!apply) return;
  const already = await (prisma as any).signupBonusLedger.findFirst({ where: { orderId, kind: 'COMMIT' } });
  if (already) return; // idempotent

  const delta = Number(apply.delta);
  await prisma.$transaction(async (tx: any) => {
    await tx.signupBonusGrant.update({
      where: { id: apply.grantId },
      data: {
        pendingAmount: { decrement: delta as any },
        usedAmount:    { increment: delta as any },
        remainingOrders: { decrement: 1 }
      }
    });
    await tx.signupBonusLedger.create({
      data: { grantId: apply.grantId, orderId, kind: 'COMMIT', delta: delta as any, note: 'order delivered' }
    });
  });
  await audit('signup_bonus.consumed' as any, {
    actorId: null, entityType: 'SignupBonusGrant', entityId: apply.grantId,
    before: null, after: { orderId, amount: delta }
  });
}

/**
 * Restore on cancel/refund. Two paths:
 *   - Order never delivered → release the pending hold (no commit yet).
 *   - Order delivered then refunded → reverse the commit AND restore the
 *     orders counter.
 */
export async function restoreSignupBonusForOrder(orderId: string): Promise<void> {
  const apply = await (prisma as any).signupBonusLedger.findFirst({ where: { orderId, kind: 'APPLY' } });
  if (!apply) return;
  const restored = await (prisma as any).signupBonusLedger.findFirst({ where: { orderId, kind: 'RESTORE' } });
  if (restored) return; // idempotent
  const committed = await (prisma as any).signupBonusLedger.findFirst({ where: { orderId, kind: 'COMMIT' } });

  const delta = Number(apply.delta);
  await prisma.$transaction(async (tx: any) => {
    if (committed) {
      // Was delivered → reverse the commit.
      await tx.signupBonusGrant.update({
        where: { id: apply.grantId },
        data: {
          usedAmount:      { decrement: delta as any },
          remainingOrders: { increment: 1 }
        }
      });
    } else {
      // Was only pending → release the hold.
      await tx.signupBonusGrant.update({
        where: { id: apply.grantId },
        data: { pendingAmount: { decrement: delta as any } }
      });
    }
    await tx.signupBonusLedger.create({
      data: { grantId: apply.grantId, orderId, kind: 'RESTORE', delta: (-delta) as any, note: committed ? 'order cancelled after delivery' : 'order cancelled before delivery' }
    });
  });
  await audit('signup_bonus.restored' as any, {
    actorId: null, entityType: 'SignupBonusGrant', entityId: apply.grantId,
    before: null, after: { orderId, amount: delta, wasDelivered: !!committed }
  });
}
