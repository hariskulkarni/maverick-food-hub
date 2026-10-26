/**
 * Google review acquisition — shared rules for post-order review asks.
 *
 * Compliance (Google contribution policy, FTC 16 CFR 465, India IS 19000):
 *   - every eligible customer is asked the same way (no gating by sentiment);
 *   - the Google review link is shown at EVERY rating, before and after feedback;
 *   - asks carry no promo/incentive text and always include a STOP link;
 *   - low ratings additionally open a service-recovery ticket — they never hide
 *     the Google link.
 *
 * Pure helpers first (unit-tested without a DB), then thin DB-aware wrappers.
 */
import { randomBytes } from 'node:crypto';
import type { ReviewRequestChannel } from '@prisma/client';
import { prisma } from '@/server/db';
import { log } from '@/server/log';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in').replace(/\/$/, '');

/** India-only platform: quiet hours are evaluated in IST (UTC+5:30). */
const IST_OFFSET_MIN = 330;
/** An ask that could not go out within this window (job down, long quiet run) is dropped, not sent late. */
export const STALE_ASK_MS = 72 * 60 * 60 * 1000;

export type SendChannel = Exclude<ReviewRequestChannel, 'QR'>;
export const SEND_CHANNELS: SendChannel[] = ['SMS', 'WHATSAPP', 'EMAIL'];

export interface AcquisitionConfig {
  enabled: boolean;
  channels: SendChannel[];
  delayMinutes: number;
  quietStartHour: number | null;
  quietEndHour: number | null;
  reminderEnabled: boolean;
  reminderAfterHours: number;
  frequencyCapDays: number;
  lowRatingThreshold: number;
  gbpPlaceId: string | null;
  gbpReviewUrl: string | null;
  googleReviewUrlOverride: string | null;
  whatsappTemplateName: string | null;
  whatsappTemplateLang: string | null;
}

export const DEFAULT_CONFIG: AcquisitionConfig = {
  enabled: false,
  channels: ['SMS'],
  delayMinutes: 60,
  quietStartHour: 21,
  quietEndHour: 9,
  reminderEnabled: false,
  reminderAfterHours: 24,
  frequencyCapDays: 30,
  lowRatingThreshold: 3,
  gbpPlaceId: null,
  gbpReviewUrl: null,
  googleReviewUrlOverride: null,
  whatsappTemplateName: null,
  whatsappTemplateLang: null,
};

// ── Pure: time rules ─────────────────────────────────────────────────────

export function istHour(d: Date): number {
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN;
  return Math.floor(mins / 60) % 24;
}

/** True while start <= IST hour < end. Wraps midnight (21 → 9). Null/equal bounds = no quiet hours. */
export function isQuietHour(now: Date, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) return false;
  const h = istHour(now);
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export function isStale(dueAt: Date, now: Date): boolean {
  return now.getTime() - dueAt.getTime() > STALE_ASK_MS;
}

export function computeDueAt(deliveredAt: Date, delayMinutes: number): Date {
  return new Date(deliveredAt.getTime() + Math.max(0, delayMinutes) * 60_000);
}

export function reminderDueAt(sentAt: Date, cfg: Pick<AcquisitionConfig, 'reminderEnabled' | 'reminderAfterHours'>): Date | null {
  return cfg.reminderEnabled ? new Date(sentAt.getTime() + cfg.reminderAfterHours * 3_600_000) : null;
}

// ── Pure: channel + links + copy ─────────────────────────────────────────

/** First configured channel the customer can be reached on. WhatsApp needs an approved template. */
export function pickChannel(
  channels: SendChannel[],
  contact: { phone?: string | null; email?: string | null },
  whatsappReady: boolean,
): SendChannel | null {
  for (const c of channels) {
    if (c === 'SMS' && contact.phone) return c;
    if (c === 'WHATSAPP' && contact.phone && whatsappReady) return c;
    if (c === 'EMAIL' && contact.email) return c;
  }
  return null;
}

export function newToken(): string {
  return randomBytes(18).toString('base64url');
}

export const trackedLink = (token: string) => `${SITE_URL}/rv/${token}`;
export const stopLink = (token: string) => `${SITE_URL}/rv/${token}/stop`;

export function writeReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/** Manual override → GBP location review link → GBP place ID → Places quick-connect place ID. */
export function buildGoogleReviewUrl(src: {
  override?: string | null;
  gbpReviewUrl?: string | null;
  gbpPlaceId?: string | null;
  placesPlaceId?: string | null;
}): { url: string | null; source: 'override' | 'gbp' | 'places' | null } {
  if (src.override) return { url: src.override, source: 'override' };
  if (src.gbpReviewUrl) return { url: src.gbpReviewUrl, source: 'gbp' };
  if (src.gbpPlaceId) return { url: writeReviewUrl(src.gbpPlaceId), source: 'gbp' };
  if (src.placesPlaceId) return { url: writeReviewUrl(src.placesPlaceId), source: 'places' };
  return { url: null, source: null };
}

/** Order-specific, promo-free copy. Every variant carries the STOP link. */
export function buildAskMessage(a: {
  kind: 'ask' | 'reminder';
  restaurantName: string;
  orderCode: string;
  link: string;
  stop: string;
}): { sms: string; subject: string; html: string; text: string } {
  const lead = a.kind === 'reminder' ? 'Quick reminder: how' : 'How';
  const sms = `${lead} was your ${a.restaurantName} order ${a.orderCode}? Rate it: ${a.link} . Stop review requests: ${a.stop}`;
  const subject = `${a.kind === 'reminder' ? 'Reminder: ' : ''}How was your order ${a.orderCode} from ${a.restaurantName}?`;
  const text = [
    `${lead} was your ${a.restaurantName} order ${a.orderCode}?`,
    '',
    `Rate your order: ${a.link}`,
    '',
    `Don't want these requests? ${a.stop}`,
  ].join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#222">
<p style="font-size:16px">${esc(lead)} was your <b>${esc(a.restaurantName)}</b> order <b>${esc(a.orderCode)}</b>?</p>
<p><a href="${esc(a.link)}" style="display:inline-block;padding:10px 16px;background:#e85d2a;color:#fff;text-decoration:none;border-radius:8px">Rate your order</a></p>
<p style="font-size:12px;color:#777">Don't want review requests? <a href="${esc(a.stop)}">Unsubscribe</a>.</p>
</div>`;
  return { sms, subject, html, text };
}

/** The rating that decides service recovery: overall if given, else the worst axis. */
export function effectiveRating(f: { overallRating?: number | null; foodRating?: number | null; deliveryRating?: number | null }): number | null {
  if (f.overallRating != null) return f.overallRating;
  const axes = [f.foodRating, f.deliveryRating].filter((n): n is number => n != null);
  return axes.length ? Math.min(...axes) : null;
}

export function needsRecovery(rating: number | null, threshold: number): boolean {
  return rating != null && rating <= threshold;
}

// ── DB-aware ─────────────────────────────────────────────────────────────

export async function loadAcquisitionConfig(restaurantId: string): Promise<AcquisitionConfig> {
  const row = await prisma.reviewRequestConfig.findUnique({ where: { restaurantId } });
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    enabled: row.enabled,
    channels: row.channels.filter((c): c is SendChannel => c !== 'QR'),
    delayMinutes: row.delayMinutes,
    quietStartHour: row.quietStartHour,
    quietEndHour: row.quietEndHour,
    reminderEnabled: row.reminderEnabled,
    reminderAfterHours: row.reminderAfterHours,
    frequencyCapDays: row.frequencyCapDays,
    lowRatingThreshold: row.lowRatingThreshold,
    gbpPlaceId: row.gbpPlaceId,
    gbpReviewUrl: row.gbpReviewUrl,
    googleReviewUrlOverride: row.googleReviewUrlOverride,
    whatsappTemplateName: row.whatsappTemplateName,
    whatsappTemplateLang: row.whatsappTemplateLang,
  };
}

export async function resolveGoogleReviewUrl(restaurantId: string, cfg?: AcquisitionConfig) {
  const c = cfg ?? (await loadAcquisitionConfig(restaurantId));
  const places = await prisma.reviewAutoReplyConfig
    .findUnique({ where: { restaurantId }, select: { googlePlaceId: true } })
    .catch(() => null);
  return buildGoogleReviewUrl({
    override: c.googleReviewUrlOverride,
    gbpReviewUrl: c.gbpReviewUrl,
    gbpPlaceId: c.gbpPlaceId,
    placesPlaceId: places?.googlePlaceId ?? null,
  });
}

/** Opted out of this restaurant's asks, or of all asks platform-wide. */
export async function isOptedOut(customerId: string, restaurantId: string): Promise<boolean> {
  const hit = await prisma.reviewRequestOptOut.findFirst({
    where: { customerId, OR: [{ restaurantId }, { restaurantId: null }] },
    select: { id: true },
  });
  return !!hit;
}

/** True when this customer was already asked by this restaurant inside the cap window. */
export async function hitsFrequencyCap(a: {
  customerId: string;
  restaurantId: string;
  capDays: number;
  excludeId: string;
  now: Date;
}): Promise<boolean> {
  if (a.capDays <= 0) return false;
  const since = new Date(a.now.getTime() - a.capDays * 86_400_000);
  const n = await prisma.reviewRequest.count({
    where: { customerId: a.customerId, restaurantId: a.restaurantId, sentAt: { gte: since }, id: { not: a.excludeId } },
  });
  return n > 0;
}

/**
 * Queue the post-order ask (called on DELIVERED, incl. pickup handover).
 * Idempotent: ReviewRequest.orderId is unique, a duplicate create is a no-op.
 * Returns true when the restaurant's acquisition flow owns the ask.
 */
export async function scheduleReviewRequest(a: {
  orderId: string;
  restaurantId: string;
  customerId: string;
  deliveredAt: Date;
}): Promise<boolean> {
  const cfg = await loadAcquisitionConfig(a.restaurantId);
  if (!cfg.enabled) return false;
  try {
    await prisma.reviewRequest.create({
      data: {
        restaurantId: a.restaurantId,
        orderId: a.orderId,
        customerId: a.customerId,
        channel: cfg.channels[0] ?? 'SMS',
        token: newToken(),
        status: 'SCHEDULED',
        dueAt: computeDueAt(a.deliveredAt, cfg.delayMinutes),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
    log.info({ orderId: a.orderId }, 'review request already scheduled');
  }
  return true;
}

export interface FunnelStats {
  since: string;
  sent: number;
  clicked: number;
  feedback: number;
  googleClicks: number;
  optOuts: number;
  qrScans: number;
}

/** Last-30-day funnel from ReviewRequest + opt-out logs. */
export async function funnelStats(restaurantId: string, now: Date = new Date()): Promise<FunnelStats> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const base = { restaurantId };
  const [sent, clicked, feedback, googleClicks, optOuts, qrScans] = await Promise.all([
    prisma.reviewRequest.count({ where: { ...base, channel: { not: 'QR' }, sentAt: { gte: since } } }),
    prisma.reviewRequest.count({ where: { ...base, channel: { not: 'QR' }, clickedAt: { gte: since } } }),
    prisma.reviewRequest.count({ where: { ...base, feedbackAt: { gte: since } } }),
    prisma.reviewRequest.count({ where: { ...base, googleClickedAt: { gte: since } } }),
    prisma.reviewRequestOptOut.count({ where: { sourceRestaurantId: restaurantId, createdAt: { gte: since } } }),
    prisma.reviewRequest.count({ where: { ...base, channel: 'QR', clickedAt: { gte: since } } }),
  ]);
  return { since: since.toISOString(), sent, clicked, feedback, googleClicks, optOuts, qrScans };
}

/** Tokens are 24-char base64url; accept a small range so malformed paths 404 without a DB hit. */
export function isValidToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(t);
}
