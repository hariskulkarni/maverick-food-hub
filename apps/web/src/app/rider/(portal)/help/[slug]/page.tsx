/**
 * One rider help article. The "install the rider app" article also shows the
 * live download card (active release, QR, SHA-256) above the text.
 */
import { notFound } from 'next/navigation';
import { HelpArticleView } from '@/components/help/help-article-view';
import { AppDownloadCard } from '@/components/rider/app-download-card';
import { audiencesForRole, parseLanguage } from '@/server/help/audience';
import { getArticle } from '@/server/help/articles';

export const dynamic = 'force-dynamic';

const INSTALL_ARTICLE_SLUG = 'rider-install-app';

export default async function RiderHelpArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const lang = parseLanguage((await searchParams).lang);
  const article = /^[a-z0-9-]{1,80}$/.test(slug) ? await getArticle(slug, audiencesForRole('RIDER'), lang, { countView: true }) : null;
  if (!article) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {slug === INSTALL_ARTICLE_SLUG && <AppDownloadCard id="download" />}
      <HelpArticleView article={article} basePath="/rider/help" canFeedback showContact={false} apiBase="/api/rider/help" />
    </div>
  );
}
