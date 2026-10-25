import Link from 'next/link';
import type { Metadata } from 'next';
import { HelpArticlePage } from '@/components/help/help-pages';
import { getArticle } from '@/server/help/articles';
import { parseLanguage } from '@/server/help/audience';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const slug = (await params).slug;
  const a = /^[a-z0-9-]{1,80}$/.test(slug)
    ? await getArticle(slug, ['CUSTOMER', 'ALL'], parseLanguage((await searchParams).lang), { countView: false })
    : null;
  return a ? { title: `${a.title} · Help`, description: a.summary } : { title: 'Help' };
}

export default async function FaqArticle({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  return (
    <div className="container max-w-4xl py-8 md:py-12">
      <HelpArticlePage basePath="/faq" slug={(await params).slug} lang={(await searchParams).lang} showContact={false} />
      <p className="mx-4 mt-2 text-sm text-muted-foreground sm:mx-6">
        Problem with an order?{' '}
        <Link href="/help" className="text-primary underline">
          Report it here
        </Link>
        .
      </p>
    </div>
  );
}
