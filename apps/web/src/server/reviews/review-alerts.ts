/**
 * Negative-review alerts and reply-SLA escalation for restaurant owners.
 *
 *  - Negative alert: new review rated <= alertMaxRating, created in the last
 *    48h (so a first import of old reviews never floods anyone). Each review is
 *    claimed once (GoogleReview.alertedAt) and all reviews found in one sweep go
 *    out as ONE message per channel (debounce). Email always; SMS / WhatsApp when
 *    enabled in settings. Includes the AI draft and a deep link.
 *  - SLA escalation: Business Profile reviews with no posted reply after
 *    slaHours go ONCE (GoogleReview.escalatedAt) to the configured second
 *    recipient. Only reviews from the last 14 days and created after the
 *    settings were saved are considered.
 *
 * Never throws: notification failures are logged and must not break the sweep.
 */
import { prisma } from '@/server/db';
import { notify } from '@/server/notifications';
import { phoneRecipientsForRestaurant } from '@/server/alerts';
import { log } from '@/server/log';
import { overdueWhere } from './store';

const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in';
export const ALERT_FRESH_HOURS = 48;
export const SLA_LOOKBACK_DAYS = 14;

export function reviewLink(reviewId: string): string {
  return `${SITE()}/admin/reviews?review=${encodeURIComponent(reviewId)}`;
}

/** Owner + restaurant ADMIN members + public contact email (no platform super-admins). */
export async function restaurantEmailRecipients(restaurantId: string): Promise<string[]> {
  const rest = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      contactEmail: true,
      owner: { select: { email: true } },
      members: { where: { role: 'ADMIN' }, select: { user: { select: { email: true } } } },
    },
  });
  const set = new Set<string>();
  if (rest?.owner?.email) set.add(rest.owner.email);
  rest?.members.forEach((m) => m.user?.email && set.add(m.user.email));
  if (rest?.contactEmail) set.add(rest.contactEmail);
  return [...set];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export type AlertReview = {
  id: string; rating: number; reviewerName: string | null; comment: string | null; draft: string | null;
};

export function formatNegativeAlert(restaurantName: string, reviews: AlertReview[]) {
  const n = reviews.length;
  const subject = `[${restaurantName}] ${n === 1 ? `New ${reviews[0].rating}★ Google review` : `${n} new low-rated Google reviews`}`.replace(/[\r\n]+/g, ' ');
  const text = reviews.map((r) => [
    `${r.rating}★ from ${r.reviewerName ?? 'a Google user'}`,
    r.comment ? `"${r.comment.slice(0, 300)}"` : '(no text)',
    r.draft ? `Suggested reply: ${r.draft}` : 'No AI draft (add an AI key in Settings → Reviews).',
    `Reply now: ${reviewLink(r.id)}`,
  ].join('\n')).join('\n\n');
  const html = reviews.map((r) => `
    <div style="border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:12px">
      <p style="margin:0 0 6px"><strong>${r.rating}★</strong> from ${esc(r.reviewerName ?? 'a Google user')}</p>
      <p style="margin:0 0 8px">${r.comment ? esc(r.comment.slice(0, 300)) : '<em>(no text)</em>'}</p>
      ${r.draft ? `<p style="margin:0 0 8px;color:#555"><em>Suggested reply:</em> ${esc(r.draft)}</p>` : ''}
      <a href="${reviewLink(r.id)}">Review and reply</a>
    </div>`).join('');
  const short = n === 1
    ? `${restaurantName}: new ${reviews[0].rating}* Google review. Reply: ${reviewLink(reviews[0].id)}`
    : `${restaurantName}: ${n} new low-rated Google reviews. Reply: ${SITE()}/admin/reviews`;
  return { subject, text, html: `<div style="font-family:sans-serif">${html}</div>`, short };
}

/** Claim + send one alert for the given reviews. Returns the reviews actually alerted. */
export async function sendNegativeReviewAlerts(
  restaurantId: string, candidates: AlertReview[], now = new Date(),
): Promise<number> {
  try {
    if (!candidates.length) return 0;
    const settings = await prisma.reviewResponseSettings.findUnique({ where: { restaurantId } });
    const enabled = settings?.alertEnabled ?? true;
    const maxRating = settings?.alertMaxRating ?? 2;
    if (!enabled) return 0;
    const fresh = new Date(now.getTime() - ALERT_FRESH_HOURS * 3_600_000);
    const claimed: AlertReview[] = [];
    for (const r of candidates) {
      if (r.rating > maxRating) continue;
      const c = await prisma.googleReview.updateMany({
        where: { id: r.id, restaurantId, alertedAt: null, reviewCreatedAt: { gte: fresh } },
        data: { alertedAt: now },
      });
      if (c.count === 1) claimed.push(r);
    }
    if (!claimed.length) return 0;
    const rest = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } });
    const msg = formatNegativeAlert(rest?.name ?? 'Your restaurant', claimed);
    const emails = await restaurantEmailRecipients(restaurantId);
    for (const to of emails) {
      await notify.email({ to, subject: msg.subject, body: msg.html, template: 'reviews.negative_alert', restaurantId, meta: { text: msg.text, reviewIds: claimed.map((r) => r.id) } })
        .catch((e) => log.error({ err: (e as Error).message }, 'reviews.alert.email_failed'));
    }
    if (settings?.alertSms || settings?.alertWhatsapp) {
      const phones = await phoneRecipientsForRestaurant(restaurantId);
      for (const to of phones) {
        if (settings.alertSms) await notify.sms({ to, body: msg.short, template: 'reviews.negative_alert', restaurantId }).catch(() => undefined);
        if (settings.alertWhatsapp) await notify.whatsapp({ to, body: msg.short, template: 'reviews.negative_alert', restaurantId }).catch(() => undefined);
      }
    }
    log.info({ restaurantId, n: claimed.length }, 'reviews.alert.sent');
    return claimed.length;
  } catch (e) {
    log.error({ restaurantId, err: String((e as Error)?.message ?? e) }, 'reviews.alert.failed');
    return 0;
  }
}

/** One escalation per overdue review to the second recipient. Returns reviews escalated. */
export async function runSlaEscalations(now = new Date()): Promise<number> {
  let total = 0;
  try {
    const all = await prisma.reviewResponseSettings.findMany({
      where: { OR: [{ escalationEmail: { not: null } }, { escalationPhone: { not: null } }] },
      select: { restaurantId: true, slaHours: true, escalationEmail: true, escalationPhone: true, createdAt: true, restaurant: { select: { name: true } } },
    });
    const lookback = new Date(now.getTime() - SLA_LOOKBACK_DAYS * 86_400_000);
    for (const s of all) {
      try {
        const floor = s.createdAt > lookback ? s.createdAt : lookback;
        const overdue = await prisma.googleReview.findMany({
          where: { restaurantId: s.restaurantId, escalatedAt: null, AND: [overdueWhere(s.slaHours, now), { reviewCreatedAt: { gte: floor } }] },
          select: { id: true, rating: true, reviewerName: true },
          orderBy: { reviewCreatedAt: 'asc' }, take: 20,
        });
        const claimed: typeof overdue = [];
        for (const r of overdue) {
          const c = await prisma.googleReview.updateMany({ where: { id: r.id, escalatedAt: null }, data: { escalatedAt: now } });
          if (c.count === 1) claimed.push(r);
        }
        if (!claimed.length) continue;
        const name = s.restaurant?.name ?? 'Your restaurant';
        const lines = claimed.map((r) => `${r.rating}★ ${r.reviewerName ?? 'Google user'}: ${reviewLink(r.id)}`).join('\n');
        const body = `${claimed.length} Google review${claimed.length > 1 ? 's have' : ' has'} had no reply for over ${s.slaHours}h at ${name}.\n\n${lines}`;
        if (s.escalationEmail) {
          await notify.email({ to: s.escalationEmail, subject: `[${name}] Google review reply overdue`, body: `<pre style="font-family:sans-serif;white-space:pre-wrap">${esc(body)}</pre>`, template: 'reviews.sla_escalation', restaurantId: s.restaurantId, meta: { text: body } })
            .catch(() => undefined);
        }
        if (s.escalationPhone) {
          await notify.sms({ to: s.escalationPhone, body: `${name}: ${claimed.length} Google review repl${claimed.length > 1 ? 'ies' : 'y'} overdue (> ${s.slaHours}h). ${SITE()}/admin/reviews?overdue=1`, template: 'reviews.sla_escalation', restaurantId: s.restaurantId })
            .catch(() => undefined);
        }
        total += claimed.length;
      } catch (e) {
        log.error({ restaurantId: s.restaurantId, err: String((e as Error)?.message ?? e) }, 'reviews.sla.restaurant_failed');
      }
    }
  } catch (e) {
    log.error({ err: String((e as Error)?.message ?? e) }, 'reviews.sla.failed');
  }
  return total;
}
