/**
 * Shared request handlers for the help-center read API. The web routes
 * (/api/help/*, NextAuth cookie session, anonymous = customer) and the rider
 * routes (/api/rider/help/*, Bearer token via rider-auth) differ only in how
 * the session is obtained — the audience is always derived from the
 * session's role, never from the request.
 */
import { z } from 'zod';
import type { Session } from 'next-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { rateLimit } from '@/server/http/rate-limit';
import { audiencesForRole, parseLanguage } from './audience';
import { getArticle, listArticles, listCategories, submitFeedback } from './articles';
import { logSearch, searchArticles } from './search';

type Source = 'web' | 'rider';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APP_AREA_RE = /^[a-z]+(?:\.[a-z-]+)*$/;

function viewer(session: Session | null) {
  const role = session?.user?.role ?? null;
  return { role, userId: session?.user?.id ?? null, audiences: audiencesForRole(role) };
}

const lang = (req: Request) => parseLanguage(new URL(req.url).searchParams.get('lang'));

export async function handleCategories(req: Request, session: Session | null) {
  const v = viewer(session);
  return Response.json({ categories: await listCategories(v.audiences, lang(req)) });
}

export async function handleArticles(req: Request, session: Session | null) {
  const v = viewer(session);
  const sp = new URL(req.url).searchParams;
  const appArea = sp.get('appArea');
  const category = sp.get('category');
  if ((appArea && !APP_AREA_RE.test(appArea)) || (category && !SLUG_RE.test(category))) {
    return Response.json({ error: 'Invalid filter' }, { status: 400 });
  }
  const articles = await listArticles({ audiences: v.audiences, language: lang(req), appArea, categorySlug: category, limit: 50 });
  return Response.json({ articles });
}

export async function handleArticle(req: Request, session: Session | null, slug: string) {
  if (!SLUG_RE.test(slug)) return Response.json({ error: 'Not found' }, { status: 404 });
  const v = viewer(session);
  const article = await getArticle(slug, v.audiences, lang(req), { countView: v.role !== 'SUPER_ADMIN' });
  if (!article) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ article });
}

export async function handleSearch(req: Request, session: Session | null, source: Source) {
  const rl = await rateLimit(req, { name: `help-search-${source}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const v = viewer(session);
  const language = lang(req);
  const result = await searchArticles(new URL(req.url).searchParams.get('q'), { audiences: v.audiences, language, limit: 20 });
  await logSearch({
    query: result.query,
    resultsCount: result.hits.length,
    language,
    source: source === 'web' && !session ? 'public' : source,
    role: v.role,
    userId: v.userId,
  });
  return Response.json(result);
}

const FeedbackBody = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(1000).nullish(),
});

export async function handleFeedback(req: Request, session: Session | null, slug: string) {
  if (!session?.user?.id) return Response.json({ error: 'Please sign in to send feedback.' }, { status: 401 });
  if (!SLUG_RE.test(slug)) return Response.json({ error: 'Not found' }, { status: 404 });
  const rl = await rateLimit(req, { name: 'help-feedback', limit: 30, windowMs: 600_000, key: session.user.id });
  if (!rl.ok) return rl.response;
  const body = parseOrJsonError(FeedbackBody, await req.json().catch(() => null));
  if (body instanceof Response) return body;
  const v = viewer(session);
  const ok = await submitFeedback({
    slug,
    language: lang(req),
    audiences: v.audiences,
    userId: session.user.id,
    role: v.role ?? 'UNKNOWN',
    helpful: body.helpful,
    comment: body.comment ?? null,
  });
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ ok: true });
}
