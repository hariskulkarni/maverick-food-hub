import { HelpArticlePage } from '@/components/help/help-pages';

export const metadata = { title: 'Kitchen · Help' };
export const dynamic = 'force-dynamic';

export default async function KitchenHelpArticle({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  return <HelpArticlePage basePath="/kitchen/help" slug={(await params).slug} lang={(await searchParams).lang} />;
}
