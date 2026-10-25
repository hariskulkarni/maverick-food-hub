/**
 * Shared shape + client-side validation for /platform/rider-settings.
 * Bounds mirror the zod schema in /api/platform/rider-settings (PATCH).
 */
export interface RiderSettingsDto {
  kycGate: boolean;
  maxActiveOrders: number;
  dailyGoal: number;
  weeklyGoal: number;
  trainingShiftGate: boolean;
}

export const MAX_ACTIVE_ORDERS_BOUNDS = { min: 1, max: 10 } as const;
export const DAILY_GOAL_MAX = 100_000;
export const WEEKLY_GOAL_MAX = 1_000_000;

/** Returns an error message, or null when `raw` is a valid concurrent-order cap. */
export function validateMaxActiveOrders(raw: string): string | null {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n)) return 'Enter a whole number.';
  if (n < MAX_ACTIVE_ORDERS_BOUNDS.min || n > MAX_ACTIVE_ORDERS_BOUNDS.max) {
    return `Must be between ${MAX_ACTIVE_ORDERS_BOUNDS.min} and ${MAX_ACTIVE_ORDERS_BOUNDS.max}.`;
  }
  return null;
}

/** Returns an error message, or null when `raw` is a valid ₹ goal not above `max`. */
export function validateGoal(raw: string, max: number): string | null {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) return 'Enter an amount in rupees.';
  if (n <= 0) return 'Must be more than ₹0.';
  if (n > max) return `Must be at most ₹${max.toLocaleString('en-IN')}.`;
  return null;
}

/** GET /api/platform/rider-settings/impact — riders the gates would block right now. */
export interface RiderGateImpact {
  activeRiders: number;
  onlineRiders: number;
  /** Riders failing the KYC gate (missing / unapproved / expired past grace); byType keyed by KycDocumentType. */
  kyc: { blocked: number; blockedOnline: number; byType: Partial<Record<string, number>> };
  /** Riders missing a required shift-blocking safety module. */
  training: { blocked: number; blockedOnline: number };
  computedAt: string;
}
