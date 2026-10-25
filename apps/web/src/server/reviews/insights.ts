/**
 * Per-restaurant Google review insights.
 *
 *  1. analyzePending(): topic + sentiment per review, stored in ReviewAnalysis.
 *     Uses the restaurant's own LLM key (llm.analyzeReviewsBatch) and falls
 *     back to the deterministic keyword analyser when there is no key or the
 *     call fails. Dishes are always the restaurant's OWN menu dishes.
 *  2. computeInsights(): rating trend, volume, reply rate, median reply time,
 *     overdue count, distribution, dish mentions, recurring issues and staff
 *     name mentions (passive trend only, alphabetical, never ranked).
 *  3. refreshInsights(): analyse + compute + cache in ReviewInsightsSnapshot.
 *     Called by the Google reviews sweep; the insights page reads the cache.
 */
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { analyzeReviewsBatch, LlmNotConfiguredError } from './llm';
import { overdueWhere, getResponseSettings } from './store';

export const ISSUES = ['cold', 'late', 'packaging', 'portion', 'price', 'staff'] as const;
export type Issue = (typeof ISSUES)[number];
export const ISSUE_LABELS: Record<Issue, string> = {
  cold: 'Food arrived cold', late: 'Late delivery', packaging: 'Packaging / spills',
  portion: 'Portion size', price: 'Price / value', staff: 'Staff behaviour',
};

const ISSUE_PATTERNS: Record<Issue, RegExp> = {
  cold: /\b(cold|lukewarm|not hot|stale)\b/i,
  late: /\b(late|delay(ed)?|took (too )?long|waited|waiting|slow delivery|hour late)\b/i,
  packaging: /\b(packag\w*|spill(ed|t)?|leak(ed|ing)?|container|box was|soggy)\b/i,
  portion: /\b(portion|quantity|small serving|too little|less quantity|tiny)\b/i,
  price: /\b(price[ds]?|expensive|overpriced|costly|value for money|pricey)\b/i,
  staff: /\b(rude|staff|waiter|behaviou?r|attitude|impolite|manager)\b/i,
};
const POS = /\b(great|good|amazing|awesome|delicious|tasty|loved?|excellent|best|fresh|perfect|yummy|nice|fantastic|superb)\b/i;
const NEG = /\b(bad|worst|terrible|awful|cold|bland|stale|disgusting|horrible|poor|tasteless|soggy|oily|raw|burnt|disappoint\w*)\b/i;
const GENERIC = new Set(['combo', 'special', 'meal', 'plate', 'bowl', 'thali', 'platter', 'box', 'large', 'small', 'regular', 'full', 'half', 'pack', 'family']);

type Sentiment = 'positive' | 'neutral' | 'negative';

/**
 * Dish keys from menu names: the full name, plus the head noun (last word) when
 * it is a distinctive dish word, so "Chicken Dum Biryani" and "Veg Biryani"
 * both count towards "Biryani".
 */
export function dishKeys(menuNames: string[]): Map<string, string> {
  const keys = new Map<string, string>(); // lowercase key -> display name
  for (const raw of menuNames) {
    const name = raw.trim();
    if (!name) continue;
    keys.set(name.toLowerCase(), name);
    const words = name.split(/\s+/);
    const head = words[words.length - 1];
    if (words.length > 1 && head.length >= 4 && !GENERIC.has(head.toLowerCase())) {
      const k = head.toLowerCase();
      if (!keys.has(k)) keys.set(k, head[0].toUpperCase() + head.slice(1).toLowerCase());
    }
  }
  return keys;
}

function sentenceSentiment(sentence: string, rating: number): Sentiment {
  const p = POS.test(sentence); const n = NEG.test(sentence);
  if (p && !n) return 'positive';
  if (n && !p) return 'negative';
  return rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
}

export type Analysis = { sentiment: Sentiment; issues: Issue[]; dishes: Array<{ name: string; sentiment: Sentiment }>; staff: string[] };

/** Deterministic analyser (no LLM). */
export function analyzeKeywords(text: string | null, rating: number, keys: Map<string, string>, staffNames: string[] = []): Analysis {
  const t = (text ?? '').trim();
  const sentiment: Sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : sentenceSentiment(t, rating);
  const issues = t ? ISSUES.filter((i) => ISSUE_PATTERNS[i].test(t)) : [];
  const dishes = new Map<string, Sentiment>();
  if (t) {
    const sentences = t.split(/(?<=[.!?\n])\s+/);
    // Longest keys first so a full dish name wins over its head noun.
    const sorted = [...keys.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const s of sentences) {
      let rest = s.toLowerCase();
      for (const [k, display] of sorted) {
        const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(rest)) {
          if (!dishes.has(display)) dishes.set(display, sentenceSentiment(s, rating));
          rest = rest.replace(re, ' ');
        }
      }
    }
  }
  const staff = t ? staffNames.filter((n) => n.length >= 3 && new RegExp(`\\b${n}\\b`, 'i').test(t)) : [];
  return { sentiment, issues, dishes: [...dishes.entries()].map(([name, s]) => ({ name, sentiment: s })), staff };
}

async function menuNames(restaurantId: string): Promise<string[]> {
  const rows = await prisma.menuItem.findMany({
    where: { branch: { restaurantId } }, select: { name: true }, distinct: ['name'], take: 1000,
  });
  return rows.map((r) => r.name);
}

/** First names of this restaurant's staff and dedicated riders (for passive mention trends). */
async function staffFirstNames(restaurantId: string): Promise<string[]> {
  const [members, riders] = await Promise.all([
    prisma.restaurantUser.findMany({ where: { restaurantId }, select: { user: { select: { name: true } } } }),
    prisma.riderProfile.findMany({ where: { dedicatedRestaurantId: restaurantId }, select: { user: { select: { name: true } } } }),
  ]);
  const set = new Set<string>();
  [...members, ...riders].forEach((m) => {
    const f = (m.user?.name ?? '').trim().split(/\s+/)[0];
    if (f && f.length >= 3 && /^[A-Za-z]+$/.test(f)) set.add(f[0].toUpperCase() + f.slice(1).toLowerCase());
  });
  return [...set];
}

const BATCH = 20;

/** Analyse reviews that have no analysis yet, or were edited after it. Returns count analysed. */
export async function analyzePending(restaurantId: string, limit = 200): Promise<number> {
  const pending = await prisma.googleReview.findMany({
    where: { restaurantId, OR: [{ analysis: { is: null } }] },
    select: { id: true, rating: true, comment: true },
    orderBy: { reviewCreatedAt: 'desc' }, take: limit,
  });
  if (!pending.length) return 0;
  const [names, staff] = await Promise.all([menuNames(restaurantId), staffFirstNames(restaurantId)]);
  const keys = dishKeys(names);
  let useLlm = true;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const withText = chunk.filter((r) => r.comment?.trim());
    let llm = new Map<string, Awaited<ReturnType<typeof analyzeReviewsBatch>>[number]>();
    if (useLlm && withText.length) {
      try {
        const out = await analyzeReviewsBatch({
          restaurantId, menu: [...new Set(keys.values())], issueTaxonomy: ISSUES,
          reviews: withText.map((r) => ({ id: r.id, rating: r.rating, text: r.comment! })),
        });
        llm = new Map(out.map((o) => [o.id, o]));
      } catch (e) {
        useLlm = false; // no key or provider failure: keyword fallback for the rest of this run
        if (!(e instanceof LlmNotConfiguredError)) log.warn({ restaurantId, err: String((e as Error)?.message ?? e) }, 'reviews.insights.llm_fallback');
      }
    }
    for (const r of chunk) {
      const kw = analyzeKeywords(r.comment, r.rating, keys, staff);
      const l = llm.get(r.id);
      const a = l ? { sentiment: l.sentiment, issues: l.issues, dishes: l.dishes, staff: kw.staff } : kw;
      const data = { restaurantId, sentiment: a.sentiment, issues: a.issues, dishes: a.dishes, staff: a.staff, method: l ? 'llm' : 'keyword', analyzedAt: new Date() };
      await prisma.reviewAnalysis.upsert({ where: { reviewId: r.id }, create: { reviewId: r.id, ...data }, update: data });
    }
  }
  return pending.length;
}

/** Re-analyse a review after the reviewer edited it. */
export async function invalidateAnalysis(reviewId: string): Promise<void> {
  await prisma.reviewAnalysis.deleteMany({ where: { reviewId } });
}

export type InsightsData = {
  periodDays: number;
  totals: { reviews: number; average: number | null; replyRate: number | null; medianReplyHours: number | null; overdue: number };
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  weekly: Array<{ week: string; count: number; average: number | null }>;
  dishes: Array<{ name: string; mentions: number; positivePct: number }>;
  issues: Array<{ key: Issue; label: string; count: number }>;
  staffMentions: Array<{ name: string; mentions: number }>;
  analysis: { analyzed: number; method: 'llm' | 'keyword' | 'mixed' | 'none' };
  google: { average: number | null; total: number | null } | null;
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function computeInsights(restaurantId: string, opts: { days?: number; now?: Date } = {}): Promise<InsightsData> {
  const days = opts.days ?? 90;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const settings = await getResponseSettings(restaurantId);
  const [rows, overdue] = await Promise.all([
    prisma.googleReview.findMany({
      where: { restaurantId, reviewCreatedAt: { gte: since } },
      select: {
        rating: true, reviewCreatedAt: true,
        reply: { select: { state: true, postedAt: true } },
        analysis: { select: { sentiment: true, issues: true, dishes: true, staff: true, method: true } },
      },
    }),
    prisma.googleReview.count({ where: { restaurantId, ...overdueWhere(settings.slaHours, now) } }),
  ]);

  const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as InsightsData['distribution'];
  const weeks = new Map<string, { n: number; sum: number }>();
  const replyHours: number[] = [];
  let replied = 0; let sum = 0;
  const dishes = new Map<string, { n: number; pos: number }>();
  const issues = new Map<Issue, number>();
  const staff = new Map<string, number>();
  const methods = new Set<string>();
  let analyzed = 0;

  for (const r of rows) {
    sum += r.rating;
    const k = String(Math.min(5, Math.max(1, r.rating))) as keyof typeof distribution;
    distribution[k]++;
    const w = weekStart(r.reviewCreatedAt);
    const cur = weeks.get(w) ?? { n: 0, sum: 0 };
    weeks.set(w, { n: cur.n + 1, sum: cur.sum + r.rating });
    if (r.reply?.state === 'POSTED') {
      replied++;
      if (r.reply.postedAt) replyHours.push(Math.max(0, (r.reply.postedAt.getTime() - r.reviewCreatedAt.getTime()) / 3_600_000));
    }
    const a = r.analysis;
    if (a) {
      analyzed++; methods.add(a.method);
      for (const d of (a.dishes as Array<{ name: string; sentiment: string }>) ?? []) {
        const c = dishes.get(d.name) ?? { n: 0, pos: 0 };
        dishes.set(d.name, { n: c.n + 1, pos: c.pos + (d.sentiment === 'positive' ? 1 : 0) });
      }
      a.issues.forEach((i) => ISSUES.includes(i as Issue) && issues.set(i as Issue, (issues.get(i as Issue) ?? 0) + 1));
      a.staff.forEach((s) => staff.set(s, (staff.get(s) ?? 0) + 1));
    }
  }

  const mh = median(replyHours);
  return {
    periodDays: days,
    totals: {
      reviews: rows.length,
      average: rows.length ? r1(sum / rows.length) : null,
      replyRate: rows.length ? Math.round((replied / rows.length) * 100) : null,
      medianReplyHours: mh == null ? null : r1(mh),
      overdue,
    },
    distribution,
    weekly: [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-13)
      .map(([week, v]) => ({ week, count: v.n, average: v.n ? r1(v.sum / v.n) : null })),
    dishes: [...dishes.entries()].map(([name, v]) => ({ name, mentions: v.n, positivePct: Math.round((v.pos / v.n) * 100) }))
      .sort((a, b) => b.mentions - a.mentions).slice(0, 15),
    issues: [...issues.entries()].map(([key, count]) => ({ key, label: ISSUE_LABELS[key], count })).sort((a, b) => b.count - a.count),
    // Passive trend only: alphabetical, never ranked.
    staffMentions: [...staff.entries()].map(([name, mentions]) => ({ name, mentions })).sort((a, b) => a.name.localeCompare(b.name)),
    analysis: { analyzed, method: methods.size === 0 ? 'none' : methods.size > 1 ? 'mixed' : (methods.values().next().value as 'llm' | 'keyword') },
    google: settings.googleTotalReviewCount != null || settings.googleAverageRating != null
      ? { average: settings.googleAverageRating, total: settings.googleTotalReviewCount } : null,
  };
}

export async function refreshInsights(restaurantId: string): Promise<InsightsData> {
  await analyzePending(restaurantId);
  const data = await computeInsights(restaurantId);
  await prisma.reviewInsightsSnapshot.upsert({
    where: { restaurantId },
    create: { restaurantId, data: data as any, computedAt: new Date() },
    update: { data: data as any, computedAt: new Date() },
  });
  return data;
}

export async function getCachedInsights(restaurantId: string): Promise<{ data: InsightsData; computedAt: Date } | null> {
  const row = await prisma.reviewInsightsSnapshot.findUnique({ where: { restaurantId } });
  return row ? { data: row.data as unknown as InsightsData, computedAt: row.computedAt } : null;
}
