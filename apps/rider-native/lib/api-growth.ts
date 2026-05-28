/**
 * Growth & Support API module — the native app's typed client for the
 * loyalty-tier, refer-a-rider, in-app support, and training endpoints under
 * `/api/rider/{tier,referrals,support,training}`.
 *
 * Built on the shared `apiRequest` helper from `lib/api.ts`, so auth-header
 * plumbing and JSON in/out are handled for us.
 */
import { apiRequest } from './api';

// ─── Tier ────────────────────────────────────────────────────────────────────

export type TierName = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface TierDef {
  name: TierName;
  minDeliveries: number;
  minRating: number;
  requirement: string;
  perks: string[];
}

export interface TierResponse {
  current: TierDef;
  next: TierDef | null;
  /** 0–1 progress toward the next tier. */
  progressToNext: number;
  perks: string[];
  allTiers: (TierDef & { achieved: boolean })[];
  stats: { totalDeliveries: number; rating: number };
}

// ─── Referrals ───────────────────────────────────────────────────────────────

export type ReferralStatus = 'PENDING' | 'SIGNED_UP' | 'QUALIFIED' | 'REWARDED';

export interface Referral {
  id: string;
  refereePhone: string | null;
  refereeName: string | null;
  status: ReferralStatus;
  bonusAmount: number;
  createdAt: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
}

export interface ReferralsResponse {
  code: string;
  totalEarned: number;
  referrals: Referral[];
}

// ─── Support ─────────────────────────────────────────────────────────────────

export type TicketCategory =
  | 'PAYMENT'
  | 'APP_BUG'
  | 'ORDER_ISSUE'
  | 'KYC'
  | 'ACCOUNT'
  | 'SAFETY'
  | 'OTHER';

export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_RIDER'
  | 'RESOLVED'
  | 'CLOSED';

export interface TicketSummary {
  id: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: { body: string; fromRider: boolean; createdAt: string } | null;
}

export interface SupportTicketsResponse {
  tickets: TicketSummary[];
}

export interface TicketMessage {
  id: string;
  fromRider: boolean;
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface TicketThread {
  id: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

// ─── Training ────────────────────────────────────────────────────────────────

export type TrainingCategory =
  | 'ONBOARDING'
  | 'SAFETY'
  | 'CUSTOMER_SERVICE'
  | 'EARNINGS'
  | 'APP_GUIDE';

export interface TrainingModuleSummary {
  id: string;
  title: string;
  summary: string | null;
  category: TrainingCategory;
  durationMin: number;
  order: number;
  isRequired: boolean;
  completed: boolean;
  completedAt: string | null;
  quizScore: number | null;
}

export interface TrainingResponse {
  modules: TrainingModuleSummary[];
  completedCount: number;
  totalCount: number;
  requiredRemaining: number;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  /** Index of the correct option, when the payload includes it. */
  answer?: number;
}

/** A block in the new block-based lesson format. The native renderer
 *  dispatches on `type` and is forwards-compatible: unknown types are skipped. */
export type ContentBlock =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'image'; src: string; alt?: string; caption?: string }
  | { id: string; type: 'callout'; tone: 'tip' | 'warning' | 'success' | 'danger' | 'info'; title?: string; body: string }
  | { id: string; type: 'checklist'; title?: string; items: string[] }
  | { id: string; type: 'keyPoints'; title?: string; points: string[] }
  | { id: string; type: 'divider' }
  | { id: string; type: 'quiz'; question: string; options: string[]; correct: number; explanation?: string };

export interface TrainingModuleDetail {
  id: string;
  title: string;
  summary: string | null;
  category: TrainingCategory;
  contentBody: string;
  /** Block-based lesson content. Falls back to contentBody for older modules. */
  contentBlocks?: ContentBlock[];
  contentVersion?: number;
  heroImageUrl?: string | null;
  quizQuestions: QuizQuestion[] | null;
  durationMin: number;
  isRequired: boolean;
  progress: {
    completed: boolean;
    completedAt: string | null;
    quizScore: number | null;
  };
}

export interface ModuleProgress {
  completed: boolean;
  completedAt: string | null;
  quizScore: number | null;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const growth = {
  /** The rider's loyalty-tier standing + ladder. */
  tier: () => apiRequest<TierResponse>('/api/rider/tier'),

  /** The rider's referral code, history, and total bonus earned. */
  referrals: () => apiRequest<ReferralsResponse>('/api/rider/referrals'),

  /** Log a new referral against the rider's code. */
  createReferral: (refereePhone: string, refereeName?: string) =>
    apiRequest<Referral>('/api/rider/referrals', {
      method: 'POST',
      body: { refereePhone, ...(refereeName ? { refereeName } : {}) },
    }),

  /** The rider's support tickets, newest-updated first. */
  supportTickets: () =>
    apiRequest<SupportTicketsResponse>('/api/rider/support'),

  /** Open a new support ticket with its first message. */
  createTicket: (subject: string, category: TicketCategory, message: string) =>
    apiRequest<TicketSummary>('/api/rider/support', {
      method: 'POST',
      body: { subject, category, message },
    }),

  /** One ticket with its full message thread. */
  ticket: (id: string) =>
    apiRequest<TicketThread>(`/api/rider/support/${id}`),

  /** Append a rider reply to a ticket; returns the updated thread. */
  replyTicket: (id: string, body: string) =>
    apiRequest<TicketThread>(`/api/rider/support/${id}`, {
      method: 'POST',
      body: { body },
    }),

  /** The training catalogue merged with the rider's progress. */
  training: () => apiRequest<TrainingResponse>('/api/rider/training'),

  /** One training module with full content + the rider's progress. */
  trainingModule: (id: string) =>
    apiRequest<TrainingModuleDetail>(`/api/rider/training/${id}`),

  /** Mark a module complete, optionally with a quiz score. */
  completeModule: (id: string, quizScore?: number) =>
    apiRequest<ModuleProgress>(`/api/rider/training/${id}`, {
      method: 'POST',
      body: quizScore !== undefined ? { quizScore } : {},
    }),
};
