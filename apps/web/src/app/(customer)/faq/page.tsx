import Link from 'next/link';
import { brand } from '@/lib/brand';
import { HelpIndexPage } from '@/components/help/help-pages';

export const metadata = {
  title: 'Help & FAQ',
  description: `Answers to common questions about ordering, payment, delivery, refunds and partnering with ${brand.name}.`
};
// Articles come from the help-center knowledge base (authored in /platform/help).
export const dynamic = 'force-dynamic';

export default async function FaqPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  return (
    <div className="container max-w-4xl py-8 md:py-12">
      <HelpIndexPage
        basePath="/faq"
        lang={(await searchParams).lang}
        title="Help & FAQ"
        intro="Answers to the questions we hear most — search or browse by topic."
        showContact={false}
      />
      <div className="mx-4 mt-6 rounded-2xl border bg-secondary/40 p-6 text-center sm:mx-6">
        <h2 className="display text-xl font-semibold">Didn&apos;t find your answer?</h2>
        <p className="mt-3 text-sm">
          <Link href="/help" className="text-primary font-medium underline">
            Report a problem with an order
          </Link>{' '}
          ·{' '}
          <Link href="/track" className="text-primary font-medium underline">
            Track an order
          </Link>
        </p>
      </div>
    </div>
  );
}
