import { HelpIndexPage } from '@/components/help/help-pages';

export const metadata = { title: 'Admin · Help center' };
export const dynamic = 'force-dynamic';

export default async function AdminHelpPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return (
    <HelpIndexPage
      basePath="/admin/help"
      lang={(await searchParams).lang}
      intro="Guides for running your restaurant on Flavrly — orders, menu, delivery, offers, reviews and reports."
    />
  );
}
