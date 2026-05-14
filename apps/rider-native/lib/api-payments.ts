/**
 * Earnings & Payments API module for the Oak & Sizzler rider app.
 *
 * Wraps the /api/rider/{payouts,incentives,surge,cod} endpoints. Built on the
 * shared `apiRequest` helper — Bearer auth and JSON in/out are handled there,
 * so this file is just typed shapes plus thin call wrappers.
 */
import { apiRequest } from './api';

// ─── Payouts ─────────────────────────────────────────────────────────────────

export type PayoutStatus = 'REQUESTED' | 'PROCESSING' | 'PAID' | 'FAILED';
export type PayoutMethod = 'UPI' | 'BANK';

export interface Payout {
  id: string;
  amount: number;
  status: PayoutStatus;
  method: string; // "UPI" | "BANK"
  upiId: string | null;
  reference: string | null;
  note: string | null;
  requestedAt: string;
  processedAt: string | null;
}

export interface PayoutsResponse {
  availableBalance: number;
  lifetimeEarnings: number;
  totalPaidOut: number;
  payouts: Payout[];
}

// ─── Incentives ──────────────────────────────────────────────────────────────

export type IncentivePeriod = 'DAILY' | 'WEEKLY';

export interface Incentive {
  id: string;
  title: string;
  description: string | null;
  period: IncentivePeriod;
  targetDeliveries: number;
  bonusAmount: number;
  deliveriesDone: number;
  achieved: boolean;
  remaining: number;
}

export interface IncentivesResponse {
  incentives: Incentive[];
}

// ─── Surge ───────────────────────────────────────────────────────────────────

export interface SurgeZone {
  id: string;
  name: string;
  label: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  multiplier: number;
}

export interface SurgeResponse {
  zones: SurgeZone[];
}

// ─── COD ─────────────────────────────────────────────────────────────────────

export type CodStatus =
  | 'PENDING_COLLECTION'
  | 'COLLECTED'
  | 'PARTIAL_COLLECTED'
  | 'MISMATCH'
  | 'DEPOSIT_PENDING'
  | 'RECONCILED'
  | 'WAIVED';

export interface CodCollection {
  id: string;
  orderCode: string;
  amountToCollect: number;
  amountCollected: number | null;
  status: CodStatus;
  collectedAt: string | null;
  reconciledAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CodResponse {
  cashInHand: number;
  collections: CodCollection[];
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const payments = {
  /** Withdrawable balance + payout history. */
  payouts: () => apiRequest<PayoutsResponse>('/api/rider/payouts'),

  /** Request an instant withdrawal. Demo backend settles it immediately. */
  requestPayout: (amount: number, method: PayoutMethod, upiId?: string) =>
    apiRequest<{ payout: Payout }>('/api/rider/payouts', {
      method: 'POST',
      body: { amount, method, ...(upiId ? { upiId } : {}) },
    }),

  /** Active incentive slabs with this rider's live progress. */
  incentives: () => apiRequest<IncentivesResponse>('/api/rider/incentives'),

  /** Currently-live surge zones, hottest multiplier first. */
  surge: () => apiRequest<SurgeResponse>('/api/rider/surge'),

  /** This rider's COD collections + total cash in hand. */
  cod: () => apiRequest<CodResponse>('/api/rider/cod'),
};
