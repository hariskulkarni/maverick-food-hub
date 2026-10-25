/**
 * Server-rendered help-center pages shared by /admin/help, /kitchen/help and
 * /faq. Audience comes from the signed-in role (see server/help/audience.ts).
 */
import { notFound } from 'next/navigation';
import { auth } from '@/server/auth';
import { audiencesForRole, parseLanguage } from '@/server/help/audience';
import { getArticle, listCategories } from '@/server/help/articles';
import { HelpHome } from './help-home';
import { HelpArticleView } from './help-article-view';
import { ContactSupport } from './contact-support';

export async function HelpIndexPage({
  basePath,
  lang,
  title = 'Help center',
  intro,
  showContact = true,
}: {
  basePath: string;
  lang?: string;
  title?: string;
  intro?: string;
  showContact?: boolean;
}) {
  const session = await auth();
  const language = parseLanguage(lang);
  const categories = await listCategories(audiencesForRole(session?.user?.role), language);
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="display text-2xl font-semibold md:text-3xl">{title}</h1>
        {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
      </header>
      <HelpHome categories={categories} basePath={basePath} lang={language} />
      {showContact && session?.user && <ContactSupport />}
    </div>
  );
}

export async function HelpArticlePage({
  basePath,
  slug,
  lang,
  showContact = true,
}: {
  basePath: string;
  slug: string;
  lang?: string;
  showContact?: boolean;
}) {
  const session = await auth();
  const role = session?.user?.role ?? null;
  const article = /^[a-z0-9-]{1,80}$/.test(slug)
    ? await getArticle(slug, audiencesForRole(role), parseLanguage(lang), { countView: role !== 'SUPER_ADMIN' })
    : null;
  if (!article) notFound();
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <HelpArticleView article={article} basePath={basePath} canFeedback={!!session?.user} showContact={showContact && !!session?.user} />
    </div>
  );
}
