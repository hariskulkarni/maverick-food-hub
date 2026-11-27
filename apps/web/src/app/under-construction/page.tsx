import type { Metadata } from 'next';
import { BrandMark } from '@/components/brand-mark';
import { getMaintenance } from '@/server/maintenance';
import { brand } from '@/lib/brand';
import { Wrench } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Back shortly',
  description: `${brand.name} is closed for scheduled maintenance.`,
  // A maintenance page must never be indexed in place of the real site.
  robots: { index: false, follow: false },
};

/**
 * The holding page shown while maintenance mode is on.
 *
 * Middleware REWRITES every gated request here with a 503, so this one page
 * stands in for the whole site — storefront, admin and platform console alike.
 * The URL the visitor typed is preserved, so refreshing once the window closes
 * lands them exactly where they were going.
 *
 * It reads the operator's message straight from the config blob rather than
 * taking it from the query string: the copy on a public page shouldn't be
 * settable by whoever crafts the link.
 */
export default async function UnderConstructionPage({
  searchParams,
}: {
  searchParams: Promise<{ bypass?: string }>;
}) {
  const [{ message, since }, sp] = await Promise.all([getMaintenance(), searchParams]);
  const bypassFailed = (sp?.bypass ?? '') === 'invalid';

  const startedAt = since
    ? new Date(since).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      })
    : null;

  return (
    <main className="gradient-hero flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg text-center">
        <BrandMark className="text-2xl" />

        <div className="mx-auto mt-8 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Wrench className="size-7" aria-hidden />
        </div>

        <h1 className="display mt-6 text-3xl font-semibold tracking-tight md:text-4xl">
          We&apos;ll be back shortly
        </h1>

        <p className="mt-3 text-balance text-base text-muted-foreground">
          {message ??
            `${brand.name} is down for scheduled maintenance. Nothing is lost — your orders, addresses and saved details are all safe.`}
        </p>

        {startedAt ? (
          <p className="mt-6 text-xs text-muted-foreground">Maintenance started {startedAt} IST</p>
        ) : null}

        {bypassFailed ? (
          <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-muted-foreground">
            That access link is invalid or has expired. Generate a new one on the server with{' '}
            <code className="font-mono">npm run maintenance:status</code>.
          </p>
        ) : null}

        <p className="mt-8 text-xs text-muted-foreground">
          Need help with an order?{' '}
          <a href={`mailto:${brand.supportEmail}`} className="text-primary underline">
            {brand.supportEmail}
          </a>
        </p>
      </div>
    </main>
  );
}
