import { HelpIndexPage } from '@/components/help/help-pages';

export const metadata = { title: 'Kitchen · Help' };
export const dynamic = 'force-dynamic';

export default async function KitchenHelpPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return (
    <HelpIndexPage
      basePath="/kitchen/help"
      lang={(await searchParams).lang}
      intro="Guides for the kitchen board, order statuses and KOT printing."
    />
  );
}
