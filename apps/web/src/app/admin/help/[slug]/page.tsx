import { HelpArticlePage } from '@/components/help/help-pages';

export const metadata = { title: 'Admin · Help' };
export const dynamic = 'force-dynamic';

export default async function AdminHelpArticle({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  return <HelpArticlePage basePath="/admin/help" slug={(await params).slug} lang={(await searchParams).lang} />;
}
