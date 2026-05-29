/**
 * Demo magic-link gate landing page.
 *
 * Visible only when DEMO_MODE=true (the middleware sends every unauthenticated
 * visitor here). The page asks for an email; on submit, an API endpoint signs
 * a JWT-like token, emails the visitor a `/_demo-gate/<token>` link, and the
 * visitor clicks it to receive their 24h access cookie.
 *
 * The pre-baked demo logins are also shown so the client can hand them out
 * without leaving the page.
 */
import { redirect, notFound } from 'next/navigation';
import { Sparkles, Mail, ShieldCheck } from 'lucide-react';
import { brand } from '@/lib/brand';
import { isDemoMode, DEMO_LOGINS } from '@/lib/demo';
import { DemoGateForm } from './form';

export const dynamic = 'force-dynamic';

export default function DemoGatePage({ searchParams }: { searchParams: Promise<{ status?: string; e?: string }> }) {
  if (!isDemoMode()) return notFound();
  return <Inner searchParams={searchParams} />;
}

async function Inner({ searchParams }: { searchParams: Promise<{ status?: string; e?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="min-h-dvh grid place-items-center p-6 bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary mx-auto mb-3">
            <Sparkles className="size-7" />
          </div>
          <h1 className="display text-3xl font-bold">{brand.name} demo</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email — we&apos;ll send you a 24-hour access link.
          </p>
        </div>

        <DemoGateForm initialStatus={sp.status} initialEmail={sp.e} />

        <div className="rounded-xl border bg-card p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Once you&apos;re in, try these
          </div>
          <Login label="Super admin" email={DEMO_LOGINS.superAdmin.email} pw={DEMO_LOGINS.superAdmin.password} />
          <Login label="Restaurant admin" email={DEMO_LOGINS.admin.email} pw={DEMO_LOGINS.admin.password} />
          <Login label="Kitchen" email={DEMO_LOGINS.kitchen.email} pw={DEMO_LOGINS.kitchen.password} />
          <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
            <div>Customer / Rider OTP: <strong className="text-foreground">{DEMO_LOGINS.otpCode}</strong></div>
            <div className="mt-1">Demo customer phone: <strong className="text-foreground">{DEMO_LOGINS.customerPhone}</strong></div>
            <div>Demo rider phone: <strong className="text-foreground">{DEMO_LOGINS.riderPhone}</strong></div>
          </div>
        </div>

        <div className="text-xs text-center text-muted-foreground inline-flex items-center gap-1.5 justify-center w-full">
          <Mail className="size-3.5" /> Magic links last 24 hours — re-enter your email any time.
        </div>
      </div>
    </main>
  );
}

function Login({ label, email, pw }: { label: string; email: string; pw: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground">{email} / {pw}</span>
    </div>
  );
}
