/**
 * Demo password gate landing page.
 *
 * Visible only when DEMO_MODE=true (the middleware redirects every visitor
 * here who doesn't yet hold the gate cookie). One shared password unlocks
 * the demo for 24 hours.
 *
 * The pre-baked demo logins are listed below the form so the client can
 * hand them out without leaving the page.
 */
import { notFound } from 'next/navigation';
import { Sparkles, ShieldCheck, Clock } from 'lucide-react';
import { brand } from '@/lib/brand';
import { isDemoMode, DEMO_LOGINS } from '@/lib/demo';
import { DemoGateForm } from './form';

export const dynamic = 'force-dynamic';

export default function DemoGatePage() {
  if (!isDemoMode()) return notFound();
  return (
    <main className="min-h-dvh grid place-items-center p-6 bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary mx-auto mb-3">
            <Sparkles className="size-7" />
          </div>
          <h1 className="display text-3xl font-bold">{brand.name} demo</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the demo password to take a look around.
          </p>
        </div>

        <DemoGateForm />

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
          <Clock className="size-3.5" /> Access lasts 24 hours.
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
