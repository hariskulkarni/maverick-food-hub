/**
 * Weekly Google review digest (cron: Mondays 09:00 IST via
 * /api/platform/jobs/review-digest/run). For every restaurant with the digest
 * enabled: last 7 days' rating, review count, reply rate + median reply time,
 * top praised dishes, top issues and overdue replies, emailed to the owner and
 * restaurant admins, plus a short SMS/WhatsApp when enabled.
 *
 * Idempotent per week: digestLastSentAt is claimed atomically (6-day guard), so
 * a retried cron never double-sends. "Send test digest now" bypasses the toggle
 * and the guard for one restaurant.
 */
import { prisma } from '@/server/db';
import { notify } from '@/server/notifications';
import { phoneRecipientsForRestaurant } from '@/server/alerts';
import { log } from '@/server/log';
import { computeInsights, type InsightsData } from '@/server/reviews/insights';
import { restaurantEmailRecipients } from '@/server/reviews/review-alerts';

const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in';
const GUARD_MS = 6 * 86_400_000;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function formatDigest(restaurantName: string, d: InsightsData) {
  const t = d.totals;
  const praised = d.dishes.filter((x) => x.positivePct >= 60).slice(0, 3);
  const issues = d.issues.slice(0, 3);
  const lines = [
    `Your week on Google (last 7 days) at ${restaurantName}`,
    `Average rating: ${t.average ?? '—'}${d.google?.average != null ? ` (overall on Google: ${d.google.average.toFixed(1)} from ${d.google.total ?? '?'} reviews)` : ''}`,
    `New reviews: ${t.reviews}`,
    `Reply rate: ${t.replyRate == null ? '—' : `${t.replyRate}%`}; median reply time: ${t.medianReplyHours == null ? '—' : `${t.medianReplyHours}h`}`,
    `Top praised dishes: ${praised.length ? praised.map((x) => `${x.name} (${x.mentions}, ${x.positivePct}% positive)`).join(', ') : 'none mentioned'}`,
    `Top issues: ${issues.length ? issues.map((x) => `${x.label} (${x.count})`).join(', ') : 'none'}`,
    `Overdue replies: ${t.overdue}`,
    `Open insights: ${SITE()}/admin/reviews/insights`,
  ];
  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif"><h2 style="margin:0 0 8px">${esc(lines[0])}</h2><ul>${lines.slice(1, -1).map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p><a href="${SITE()}/admin/reviews/insights">Open insights</a> · <a href="${SITE()}/admin/reviews?overdue=1">Reply to overdue reviews</a></p></div>`;
  const short = `${restaurantName} weekly Google: ${t.reviews} reviews, avg ${t.average ?? '-'}, reply rate ${t.replyRate ?? '-'}%, ${t.overdue} overdue. ${SITE()}/admin/reviews/insights`;
  return { subject: `[${restaurantName}] Weekly Google reviews digest`.replace(/[\r\n]+/g, ' '), text, html, short };
}

export async function sendDigest(restaurantId: string, opts: { channels?: { sms: boolean; whatsapp: boolean }; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [rest, data, emails] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } }),
    computeInsights(restaurantId, { days: 7, now }),
    restaurantEmailRecipients(restaurantId),
  ]);
  const msg = formatDigest(rest?.name ?? 'Your restaurant', data);
  let sent = 0;
  for (const to of emails) {
    const r = await notify.email({ to, subject: msg.subject, body: msg.html, template: 'reviews.weekly_digest', restaurantId, meta: { text: msg.text } }).catch(() => ({ ok: false }));
    if (r.ok) sent++;
  }
  if (opts.channels?.sms || opts.channels?.whatsapp) {
    const phones = await phoneRecipientsForRestaurant(restaurantId);
    for (const to of phones) {
      if (opts.channels.sms) await notify.sms({ to, body: msg.short, template: 'reviews.weekly_digest', restaurantId }).catch(() => undefined);
      if (opts.channels.whatsapp) await notify.whatsapp({ to, body: msg.short, template: 'reviews.weekly_digest', restaurantId }).catch(() => undefined);
    }
  }
  return { recipients: emails.length, sent };
}

export async function runReviewDigest(now = new Date()) {
  const result = { restaurants: 0, sent: 0, skipped: 0, failed: 0 };
  const rows = await prisma.reviewResponseSettings.findMany({
    where: { digestEnabled: true }, select: { restaurantId: true, digestSms: true, digestWhatsapp: true },
  });
  for (const s of rows) {
    result.restaurants++;
    try {
      const claim = await prisma.reviewResponseSettings.updateMany({
        where: {
          restaurantId: s.restaurantId,
          OR: [{ digestLastSentAt: null }, { digestLastSentAt: { lt: new Date(now.getTime() - GUARD_MS) } }],
        },
        data: { digestLastSentAt: now },
      });
      if (claim.count !== 1) { result.skipped++; continue; }
      await sendDigest(s.restaurantId, { channels: { sms: s.digestSms, whatsapp: s.digestWhatsapp }, now });
      result.sent++;
    } catch (e) {
      result.failed++;
      log.error({ restaurantId: s.restaurantId, err: String((e as Error)?.message ?? e) }, 'reviews.digest.failed');
    }
  }
  log.info(result, 'reviews.digest.done');
  return result;
}
