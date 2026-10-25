/**
 * Rider help center — rider-audience articles (RIDER + ALL), same content the
 * app's Help screen reads. Search hits /api/rider/help/search (cookie auth).
 */
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { HelpHome } from '@/components/help/help-home';
import { audiencesForRole, parseLanguage } from '@/server/help/audience';
import { listCategories } from '@/server/help/articles';
import { PageHeaderStatic } from '../../_components/page-header-static';

export const dynamic = 'force-dynamic';

export default async function RiderHelpPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = parseLanguage((await searchParams).lang);
  const categories = await listCategories(audiencesForRole('RIDER'), lang);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeaderStatic title="Help center" intro="Answers for riders about the app, deliveries, earnings and safety." />
        <Link
          href={lang === 'hi' ? '/rider/help' : '/rider/help?lang=hi'}
          className="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium hover:bg-muted"
        >
          {lang === 'hi' ? 'English' : 'हिन्दी'}
        </Link>
      </div>
      <HelpHome categories={categories} basePath="/rider/help" lang={lang} apiBase="/api/rider/help" searchPlaceholder="Search rider help…" />
      <p className="flex items-start gap-2 rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        <MessageCircle className="mt-0.5 size-4 shrink-0" />
        Still stuck? Open <span className="font-medium text-foreground">Profile → Help &amp; Support</span> in the Rider app to raise a ticket, or
        message rider support on WhatsApp.
      </p>
    </div>
  );
}
