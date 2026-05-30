/**
 * Admin audit log. Call audit() from any endpoint that mutates sensitive state.
 * Append-only — never updated, never deleted. Best practice: capture `before`
 * and `after` JSON snapshots so disputes can be reconstructed.
 *
 *   await audit('restaurant.approve', { actorId, restaurantId, entityId: id, before, after });
 *   await audit('payout.adjust',      { actorId, entityType: 'RiderProfile', entityId: rid, after: { delta: 100 } });
 *
 * Failure to log is never allowed to block the actual action; we catch and
 * write to ErrorLog instead.
 */

import { prisma } from './db';
import { log } from './log';

export type AuditAction =
  // Restaurants
  | 'restaurant.approve' | 'restaurant.reject' | 'restaurant.suspend' | 'restaurant.reactivate'
  | 'restaurant.commission.update' | 'restaurant.settings.update'
  | 'restaurant.sort_order.update'
  | 'restaurant.wizard.create'
  // Riders
  | 'rider.approve' | 'rider.reject' | 'rider.suspend' | 'rider.reinstate'
  | 'rider.earnings.adjust' | 'rider.location.override'
  // Orders
  | 'order.cancel' | 'order.refund' | 'order.reassign' | 'order.force_deliver'
  // COD
  | 'cod.collect' | 'cod.reconcile' | 'cod.waive'
  // Wallet
  | 'wallet.credit' | 'wallet.debit'
  // Payouts
  | 'payout.rule.publish' | 'payout.manual'
  // Per-rider payout overrides
  | 'rider.payout.override.create'
  | 'rider.payout.override.update'
  | 'rider.payout.override.deactivate'
  // Integrations
  | 'integration.connect' | 'integration.disconnect' | 'integration.test'
  // KYC live-verification
  | 'kyc.verification.success' | 'kyc.verification.failure' | 'kyc.verification.config.update'
  // Menu
  | 'menu.price.change' | 'menu.item.toggle'
  | 'menu.bulk_toggle' | 'menu.bulk_delete'
  | 'menu.category.schedule.update'
  | 'menu.category.schedule.disable'
  | 'menu.category.toggle'
  | 'menu.combo.create' | 'menu.combo.update' | 'menu.combo.delete'
  | 'menu.cross_sell.update'
  // Users
  | 'user.create' | 'user.suspend' | 'user.role.change'
  // Offers + cross-sell (Offer engine, separate from legacy Coupons)
  | 'offer.applied'
  | 'offer.create' | 'offer.update' | 'offer.deactivate'
  | 'crosssell.create' | 'crosssell.update' | 'crosssell.delete'
  // Happy Hour pricing
  | 'happyhour.applied'
  | 'happyhour.create' | 'happyhour.update' | 'happyhour.deactivate'
  | 'happyhour.schedule.update'
  // Brand umbrella
  | 'brand.create' | 'brand.update' | 'brand.deactivate'
  | 'brand.assign_restaurants' | 'brand.unassign_restaurant'
  // Challenges + gamified rewards
  | 'challenge.create' | 'challenge.update' | 'challenge.deactivate'
  | 'challenge.reward.issued' | 'challenge.reward.redeemed'
  // Coupon campaigns
  | 'campaign.create' | 'campaign.update' | 'campaign.pause' | 'campaign.resume'
  // Signup bonus
  | 'signup_bonus.config.update'
  | 'signup_bonus.granted' | 'signup_bonus.refused'
  | 'signup_bonus.consumed' | 'signup_bonus.restored' | 'signup_bonus.revoked'
  // Post-delivery feedback
  | 'order.feedback.submitted' | 'order.feedback.edited'
  // Other
  | (string & {});

export async function audit(action: AuditAction, opts: {
  actorId?: string | null;
  actorRole?: string | null;
  restaurantId?: string | null;
  entityType?: string;
  entityId?: string | null;
  before?: any;
  after?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        actorId: opts.actorId ?? null,
        actorRole: opts.actorRole ?? null,
        restaurantId: opts.restaurantId ?? null,
        entityType: opts.entityType ?? inferEntityType(action),
        entityId: opts.entityId ?? null,
        before: opts.before ?? undefined,
        after: opts.after ?? undefined,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null
      }
    });
  } catch (e) {
    log.error({ err: e, action }, 'audit log write failed');
    // Best-effort fallback so the audit isn't completely lost
    prisma.errorLog.create({
      data: {
        level: 'error',
        source: 'audit',
        message: `Failed to record audit: ${action}`,
        metadata: { opts, err: String(e) }
      }
    }).catch(() => {});
  }
}

function inferEntityType(action: string): string {
  const root = action.split('.')[0];
  return ({
    restaurant: 'Restaurant',
    rider: 'RiderProfile',
    order: 'Order',
    cod: 'CodCollection',
    wallet: 'Wallet',
    payout: 'DeliveryPayoutRule',
    integration: 'IntegrationCredential',
    menu: 'MenuItem',
    user: 'User',
    offer: 'Offer',
    crosssell: 'CrossSell',
    happyhour: 'HappyHourRule',
    brand: 'Brand',
    challenge: 'Challenge',
    campaign: 'CouponCampaign',
    signup_bonus: 'SignupBonusGrant'
  } as Record<string, string>)[root] ?? root;
}
