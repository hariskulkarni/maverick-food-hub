/**
 * Response shapes of the /api/rider/* endpoints the portal reads. Mirrors
 * apps/rider-native/lib/api*.ts (the native app is the canonical client).
 */
export interface RiderMe {
  online: boolean;
  lastSeenAt: string | null;
  riderType: 'FLEET' | 'DEDICATED';
  dedicatedRestaurant: { id: string; name: string } | null;
  avatarUrl: string | null;
}

export interface Assignment {
  id: string;
  orderId: string;
  status: 'PENDING' | 'ACCEPTED' | 'PICKED_UP' | 'DELIVERED' | 'REJECTED' | 'CANCELLED';
  earningsAmt: string;
  assignedAt: string;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  order: {
    id: string;
    code: string;
    status: string;
    total: string;
    paymentMethod: string;
    address: { line1: string; line2: string | null; city: string; latitude: number | null; longitude: number | null; landmark?: string | null } | null;
    branch: { id: string; name: string; latitude: number | null; longitude: number | null; line1: string; city: string; restaurantName: string | null } | null;
  };
}

export interface EarningsSummary {
  lifetime: { totalEarnings: number; totalTips: number; totalDeliveries: number; rating: number };
  today: { earnings: number; deliveries: number };
  week?: { earnings: number; deliveries: number };
  last7Days?: { date: string; earnings: number; deliveries: number }[];
  goals?: { daily: number; weekly: number };
  recent: { id: string; orderCode: string; deliveredAt: string | null; earnings: number; base: number; tip: number }[];
}

export type PayoutStatus = 'REQUESTED' | 'PROCESSING' | 'PAID' | 'FAILED';
export interface Payout {
  id: string;
  amount: number;
  status: PayoutStatus;
  method: string;
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

export interface Incentive {
  id: string;
  title: string;
  description: string | null;
  period: 'DAILY' | 'WEEKLY';
  targetDeliveries: number;
  bonusAmount: number;
  deliveriesDone: number;
  achieved: boolean;
  remaining: number;
}

export interface KycDoc {
  id: string;
  type: string;
  status: string;
  numberMasked?: string | null;
  fileUrl: string;
  fileName?: string | null;
  fileMimeType?: string | null;
  issuedOn?: string | null;
  expiresOn?: string | null;
  rejectionReason?: string | null;
  submittedAt?: string | null;
}
export interface KycRequirement {
  type: string;
  label: string;
  required: boolean;
  needsExpiry: boolean;
  numberLabel: string;
  numberPlaceholder: string;
  hint: string | null;
}
export interface KycGating {
  enforced: boolean;
  canGoOnline: boolean;
  blockingTypes: string[];
  message: string | null;
}
export interface KycResponse {
  documents: KycDoc[];
  requirements?: KycRequirement[];
  accept?: string[];
  maxBytes?: number;
  gating?: KycGating;
}

export type ShiftStatus = 'BOOKED' | 'STARTED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
export interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  zoneName: string | null;
  status: ShiftStatus;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  isPrimary: boolean;
}
