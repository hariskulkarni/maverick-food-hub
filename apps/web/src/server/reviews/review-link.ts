/**
 * Tracked review link (/rv/<token>) + feedback page context, and resolution of
 * the Google review link from the connected Google Business Profile location.
 */
import { prisma } from '@/server/db';
import { getConfig } from '@/server/integrations';
import { FEEDBACK_WINDOW_MS } from '@/server/feedback';
import { loadAcquisitionConfig, needsRecovery, resolveGoogleReviewUrl } from './acquisition';
import { createOrderFeedback } from './order-feedback-submit';
import { openRecoveryTicket } from './recovery';

/** Link-preview fetchers (SMS/WhatsApp/Slack unfurls) must not count as clicks. */
export function isPreviewBot(ua: string | null): boolean {
  return !!ua && /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|skype|twitter/i.test(ua);
}

/** First click on a tracked link: stamp clickedAt (once) and move SENT → CLICKED. */
export async function recordClick(token: string, now: Date = new Date()) {
  const req = await prisma.reviewRequest.findUnique({ where: { token }, select: { id: true, status: true, clickedAt: true } });
  if (!req) return null;
  if (!req.clickedAt) {
    await prisma.reviewRequest.updateMany({ where: { id: req.id, clickedAt: null }, data: { clickedAt: now } });
    await prisma.reviewRequest.updateMany({ where: { id: req.id, status: 'SENT' }, data: { status: 'CLICKED' } });
  }
  return req;
}

export interface FeedbackContext {
  token: string;
  requestId: string;
  restaurant: { id: string; name: string; logoUrl: string | null; slug: string };
  order: { id: string; code: string; items: { name: string; quantity: number }[] } | null;
  existing: { rating: number | null; comment: string | null } | null;
  /** True when a new rating can still be saved (order window open / QR not yet answered). */
  canSubmit: boolean;
  closedReason: 'window_expired' | 'not_delivered' | null;
  googleUrl: string | null;
  lowRatingThreshold: number;
}

export async function loadFeedbackContext(token: string, now: Date = new Date()): Promise<FeedbackContext | null> {
  const r = await prisma.reviewRequest.findUnique({
    where: { token },
    include: {
      restaurant: { select: { id: true, name: true, logoUrl: true, slug: true } },
      order: {
        select: {
          id: true, code: true, status: true, deliveredAt: true, updatedAt: true,
          items: { select: { name: true, quantity: true } },
          assignment: { select: { deliveredAt: true } },
          feedback: { select: { overallRating: true, foodRating: true, deliveryRating: true, comment: true } },
        },
      },
    },
  });
  if (!r) return null;
  const cfg = await loadAcquisitionConfig(r.restaurantId);
  const { url } = await resolveGoogleReviewUrl(r.restaurantId, cfg);

  let existing: FeedbackContext['existing'] = null;
  let canSubmit = true;
  let closedReason: FeedbackContext['closedReason'] = null;
  if (r.order) {
    const f = r.order.feedback;
    if (f) existing = { rating: f.overallRating ?? f.foodRating ?? f.deliveryRating ?? null, comment: f.comment };
    const delivered = r.order.assignment?.deliveredAt ?? r.order.deliveredAt ?? (r.order.status === 'DELIVERED' ? r.order.updatedAt : null);
    if (r.order.status !== 'DELIVERED' || !delivered) closedReason = 'not_delivered';
    else if (now.getTime() > delivered.getTime() + FEEDBACK_WINDOW_MS) closedReason = 'window_expired';
    canSubmit = !f && !closedReason;
  } else {
    if (r.feedbackAt) existing = { rating: r.rating, comment: r.comment };
    canSubmit = !r.feedbackAt;
  }

  return {
    token,
    requestId: r.id,
    restaurant: r.restaurant,
    order: r.order ? { id: r.order.id, code: r.order.code, items: r.order.items } : null,
    existing,
    canSubmit,
    closedReason,
    googleUrl: url,
    lowRatingThreshold: cfg.lowRatingThreshold,
  };
}

export type LinkSubmitResult =
  | { ok: true; ticketOpened: boolean; googleUrl: string | null }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Save the star rating + optional comment left on the tracked feedback page.
 * Order asks → OrderFeedback (same path as the order page); QR-kit asks → the
 * ReviewRequest row. The returned googleUrl is identical at every rating.
 */
export async function submitFeedbackViaLink(
  token: string,
  input: { rating: number; comment?: string; contactName?: string; contactPhone?: string },
  now: Date = new Date(),
): Promise<LinkSubmitResult> {
  const ctx = await loadFeedbackContext(token, now);
  if (!ctx) return { ok: false, status: 404, error: 'Link not found' };
  if (!ctx.canSubmit) {
    return { ok: false, status: 409, error: ctx.existing ? 'Feedback already submitted' : 'Feedback window closed' };
  }
  let ticketOpened = false;
  if (ctx.order) {
    const order = await prisma.order.findUnique({
      where: { id: ctx.order.id },
      select: { customerId: true, code: true, deliveredAt: true, updatedAt: true, assignment: { select: { deliveredAt: true } } },
    });
    if (!order) return { ok: false, status: 404, error: 'Order not found' };
    const deliveredAt = order.assignment?.deliveredAt ?? order.deliveredAt ?? order.updatedAt;
    try {
      const r = await createOrderFeedback({
        orderId: ctx.order.id,
        orderCode: order.code,
        customerId: order.customerId,
        deliveredAt,
        data: { overallRating: input.rating, comment: input.comment },
        via: 'review_link',
      });
      ticketOpened = r.ticketOpened;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { ok: false, status: 409, error: 'Feedback already submitted' };
      throw e;
    }
  } else {
    const claim = await prisma.reviewRequest.updateMany({
      where: { id: ctx.requestId, feedbackAt: null },
      data: { feedbackAt: now, status: 'FEEDBACK', rating: input.rating, comment: input.comment ?? null },
    });
    if (claim.count !== 1) return { ok: false, status: 409, error: 'Feedback already submitted' };
    if (needsRecovery(input.rating, ctx.lowRatingThreshold)) {
      const t = await openRecoveryTicket({
        restaurantId: ctx.restaurant.id,
        orderId: null,
        reviewRequestId: ctx.requestId,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        rating: input.rating,
        comment: input.comment ?? null,
      });
      ticketOpened = t.created;
    }
  }
  return { ok: true, ticketOpened, googleUrl: ctx.googleUrl };
}

/** Google button click from the feedback page (first click only). */
export async function recordGoogleClick(token: string, now: Date = new Date()): Promise<boolean> {
  const r = await prisma.reviewRequest.updateMany({ where: { token, googleClickedAt: null }, data: { googleClickedAt: now } });
  return r.count === 1;
}

/**
 * STOP link: opt the customer out of review asks from this restaurant ('restaurant')
 * or from every restaurant ('all'), and cancel their pending asks. Idempotent.
 */
export async function optOutViaToken(token: string, scope: 'restaurant' | 'all'): Promise<{ ok: boolean; error?: string }> {
  const r = await prisma.reviewRequest.findUnique({ where: { token }, select: { customerId: true, restaurantId: true } });
  if (!r) return { ok: false, error: 'Link not found' };
  if (!r.customerId) return { ok: false, error: 'This link is not tied to a customer' };
  const restaurantId = scope === 'all' ? null : r.restaurantId;
  const existing = await prisma.reviewRequestOptOut.findFirst({ where: { customerId: r.customerId, restaurantId } });
  if (!existing) {
    await prisma.reviewRequestOptOut.create({ data: { customerId: r.customerId, restaurantId, sourceRestaurantId: r.restaurantId } });
  }
  await prisma.reviewRequest.updateMany({
    where: { customerId: r.customerId, status: 'SCHEDULED', ...(restaurantId ? { restaurantId } : {}) },
    data: { status: 'SKIPPED', error: 'opted_out' },
  });
  await prisma.reviewRequest.updateMany({
    where: { customerId: r.customerId, reminderAt: null, reminderDueAt: { not: null }, ...(restaurantId ? { restaurantId } : {}) },
    data: { reminderDueAt: null },
  });
  return { ok: true };
}

// ── Google Business Profile → place ID / review link ─────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BIZINFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';

/**
 * Read `metadata.placeId` / `metadata.newReviewUri` of the connected GBP
 * location. Place IDs may be stored (Places policy allows caching place IDs).
 */
export async function fetchGbpPlace(restaurantId: string): Promise<{ placeId: string | null; reviewUrl: string | null }> {
  const cfg = await getConfig(restaurantId, 'GOOGLE_BUSINESS');
  if (!cfg?.refreshToken || !cfg?.locationId) throw new Error('Google Business Profile is not connected');
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth client is not configured');
  const tok = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: cfg.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }),
  });
  if (!tok.ok) throw new Error(`google refresh ${tok.status}`);
  const access = (await tok.json())?.access_token;
  if (!access) throw new Error('google refresh: no access_token');
  const loc = cfg.locationId.startsWith('locations/') ? cfg.locationId : cfg.locationId.replace(/^.*?(locations\/[^/]+)$/, '$1');
  const res = await fetch(`${BIZINFO}/${loc}?readMask=metadata`, { headers: { authorization: `Bearer ${access}` } });
  if (!res.ok) throw new Error(`google location ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const meta = (await res.json())?.metadata ?? {};
  return { placeId: meta.placeId ? String(meta.placeId) : null, reviewUrl: meta.newReviewUri ? String(meta.newReviewUri) : null };
}
