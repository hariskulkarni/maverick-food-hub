/**
 * Authgear sandbox — start-here page for evaluating Authgear without touching
 * production auth. Renders a single "Sign in with Authgear" button. On success
 * the user lands at /login/authgear/result, which dumps the claims Authgear
 * returned so you can inspect the OIDC payload, MFA factors used, etc.
 *
 * NOT a production login page. Hidden by being at a non-obvious URL; the
 * provider self-disables when AUTHGEAR_ENABLED isn't set, so even if someone
 * lands here with the provider off they just get the "not configured" notice.
 *
 * See deploy/authgear/README.md for end-to-end setup.
 */
import Link from 'next/link';
import { auth } from '@/server/auth';
import { AuthgearSignInButton } from './authgear-sign-in-button';

export const metadata = { title: 'Authgear Sandbox' };
export const dynamic = 'force-dynamic';

export default async function AuthgearLoginPage() {
  const enabled =
    process.env.AUTHGEAR_ENABLED === 'true' &&
    !!process.env.AUTHGEAR_ISSUER &&
    !!process.env.AUTHGEAR_CLIENT_ID &&
    !!process.env.AUTHGEAR_CLIENT_SECRET;

  const session = await auth();

  return (
    <div className="container max-w-2xl py-10 md:py-16">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Sandbox</div>
      <h1 className="display mt-1 text-3xl md:text-4xl font-semibold">Authgear evaluation</h1>
      <p className="mt-2 text-muted-foreground">
        Non-destructive surface to try Authgear&apos;s MFA, OTP, passkeys, and SSO flows.
        Your existing NextAuth logins (phone-OTP / email-password / Google) keep working unchanged.
      </p>

      {/* ───── Provider status ───── */}
      <section className="mt-8 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${enabled ? 'bg-success' : 'bg-muted-foreground/40'}`}
            aria-hidden
          />
          <h2 className="display text-base font-semibold">
            {enabled ? 'Authgear provider is configured' : 'Authgear provider is not configured'}
          </h2>
        </div>
        {!enabled && (
          <div className="mt-3 text-sm text-muted-foreground space-y-2">
            <p>
              To enable, follow the steps in <code className="px-1 py-0.5 bg-muted rounded text-xs">deploy/authgear/README.md</code> —
              brings up the Authgear stack in Docker, gets you a clientId / clientSecret from the
              admin portal, and tells you what to put in <code className="px-1 py-0.5 bg-muted rounded text-xs">apps/web/.env.local</code>.
            </p>
            <p className="text-xs">
              The four env vars needed are: <code className="px-1 py-0.5 bg-muted rounded">AUTHGEAR_ENABLED=true</code>,
              {' '}<code className="px-1 py-0.5 bg-muted rounded">AUTHGEAR_ISSUER</code>,
              {' '}<code className="px-1 py-0.5 bg-muted rounded">AUTHGEAR_CLIENT_ID</code>,
              {' '}<code className="px-1 py-0.5 bg-muted rounded">AUTHGEAR_CLIENT_SECRET</code>.
            </p>
          </div>
        )}
        {enabled && (
          <div className="mt-3 text-sm text-muted-foreground">
            Issuer:{' '}
            <code className="px-1 py-0.5 bg-muted rounded text-xs">
              {process.env.AUTHGEAR_ISSUER}
            </code>
          </div>
        )}
      </section>

      {/* ───── Sign-in CTA ───── */}
      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="display text-base font-semibold">Try it</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Clicks below redirect to Authgear&apos;s hosted AuthUI. Whatever login methods + MFA
          factors you enabled in the portal are what you&apos;ll see there. After successful login
          you land on a result page that shows the OIDC claims.
        </p>
        <div className="mt-4">
          <AuthgearSignInButton enabled={enabled} />
        </div>
      </section>

      {/* ───── Current session ───── */}
      {session && (
        <section className="mt-6 rounded-2xl border bg-card p-5">
          <h2 className="display text-base font-semibold">Current NextAuth session</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You&apos;re already signed in via NextAuth (any provider). The Authgear sandbox is
            independent — signing in below creates a separate Authgear session.
          </p>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {JSON.stringify(session, null, 2)}
          </pre>
        </section>
      )}

      <div className="mt-8 text-xs text-muted-foreground">
        Back to{' '}
        <Link href="/" className="underline">home</Link>
        {' · '}
        <Link href="/login" className="underline">customer login</Link>
        {' · '}
        <Link href="/admin/orders" className="underline">admin</Link>
      </div>
    </div>
  );
}
