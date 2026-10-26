/**
 * /rider/login — rider web portal sign-in (phone + OTP, same rider-only
 * endpoints as the app). Also hosts the app download card and an application
 * status check for applicants who don't have a rider account yet.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { AppDownloadCard } from '@/components/rider/app-download-card';
import { getRiderPortalState, PORTAL_STATE_MESSAGE } from '@/server/rider-portal';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Rider sign in · Flavrly',
  description: 'Sign in to the Flavrly rider portal to see earnings, request payouts, upload documents, book shifts and take training.',
  robots: { index: false, follow: true },
};

type Reason = keyof typeof PORTAL_STATE_MESSAGE;

export default async function RiderLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string; signedOut?: string }> }) {
  const sp = await searchParams;
  const s = await getRiderPortalState();
  if (s.state === 'ok') redirect('/rider');
  const reason = (sp.reason && sp.reason in PORTAL_STATE_MESSAGE ? sp.reason : null) as Reason | null;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-primary/5 via-background to-background">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:py-14 lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-12">
        <section aria-labelledby="signin-title" className="min-w-0">
          <Link href="/rider-app" className="inline-flex min-h-11 items-center" aria-label="Flavrly rider app">
            <BrandMark className="text-xl" />
          </Link>
          <h1 id="signin-title" className="display mt-6 text-3xl font-bold md:text-4xl">
            Rider portal
          </h1>
          <p className="mt-2 text-muted-foreground">Earnings, payouts, documents, shifts and training — from any phone or computer.</p>

          {reason && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p>{PORTAL_STATE_MESSAGE[reason]}</p>
            </div>
          )}
          {!reason && sp.signedOut && (
            <div role="status" className="mt-5 flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <p>You&apos;ve signed out of the rider portal.</p>
            </div>
          )}

          <LoginForm />
        </section>

        <div className="min-w-0 space-y-4">
          <AppDownloadCard id="download" />
          <p className="text-sm text-muted-foreground">
            New to Flavrly?{' '}
            <Link href="/signup/rider" className="font-medium text-primary underline underline-offset-2">
              Apply to become a rider
            </Link>{' '}
            ·{' '}
            <Link href="/rider-app" className="font-medium text-primary underline underline-offset-2">
              How the rider app works
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
