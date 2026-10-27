import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerAuthShell } from '@/components/auth/customer/customer-auth-shell';

export const metadata = { title: 'Invite-only for now', robots: { index: false } };

/**
 * Shown when a Google account that has no Flavrly account tries to sign in
 * while ALLOW_CUSTOMER_SELF_SIGNUP=false (server/auth.ts signIn callback). No
 * account was created; existing customers can still sign in with their phone.
 */
export default function InviteOnlyPage() {
  return (
    <CustomerAuthShell>
      <div className="space-y-6 text-center">
        <ReservedSign />
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight">We&apos;re invite-only right now</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Flavrly is opening up one kitchen at a time, and this Google account isn&apos;t on the guest list yet.
            Nothing was created and nothing was charged.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button asChild size="lg" className="h-14 w-full rounded-xl text-base font-bold">
            <Link href="/login">Already a customer? Sign in with your mobile <ArrowRight aria-hidden="true" /></Link>
          </Button>
          <Button asChild variant="ghost" className="min-h-11 w-full">
            <Link href="/contact"><Mail aria-hidden="true" /> Ask us for an invite</Link>
          </Button>
        </div>
      </div>
    </CustomerAuthShell>
  );
}

/** A little "Reserved" table card — decorative. */
function ReservedSign() {
  return (
    <div aria-hidden="true" className="mx-auto h-28 w-full max-w-[200px]">
      <svg viewBox="0 0 200 120" className="h-full w-full overflow-visible" focusable="false">
        <ellipse cx="100" cy="110" rx="70" ry="7" className="fill-berry/10" />
        <g className="ob-wiggle">
          <path d="M56 98 L80 30 h40 L144 98 Z" className="fill-primary" />
          <rect x="66" y="52" width="68" height="26" rx="6" className="fill-white" />
          <text x="100" y="70" textAnchor="middle" className="fill-berry" style={{ font: '800 13px var(--font-display, sans-serif)', letterSpacing: '0.12em' }}>
            RESERVED
          </text>
        </g>
        <path d="M30 44 l4 -10 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 Z" className="ob-twinkle fill-pop" />
      </svg>
    </div>
  );
}
