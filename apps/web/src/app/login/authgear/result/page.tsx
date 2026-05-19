/**
 * Authgear sandbox — result page. Shown after the OIDC redirect lands the user
 * back in the Restaurant Manager. Renders the NextAuth session JSON so you can
 * see exactly what Authgear returned: the `sub` (Authgear user id), email,
 * phone, MFA factors used (`amr` claim), etc.
 *
 * This page does NOT create a Restaurant Manager User row. If you decide to
 * adopt Authgear, the next step is to extend the `signIn` / `jwt` callbacks
 * in apps/web/src/server/auth.ts to upsert a User on the `sub` claim — see
 * deploy/authgear/README.md → "If you decide to adopt Authgear for real".
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signOut } from '@/server/auth';

export const metadata = { title: 'Authgear result' };
export const dynamic = 'force-dynamic';

export default async function AuthgearResultPage() {
  const session = await auth();
  if (!session) redirect('/login/authgear');

  return (
    <div className="container max-w-2xl py-10 md:py-16">
      <div className="text-xs font-semibold uppercase tracking-wider text-success">Signed in</div>
      <h1 className="display mt-1 text-3xl md:text-4xl font-semibold">Authgear returned</h1>
      <p className="mt-2 text-muted-foreground">
        What you see below is the NextAuth session that resulted from the Authgear OIDC redirect.
        In a real integration, the <code className="px-1 py-0.5 bg-muted rounded text-xs">sub</code> claim
        would be linked to a Restaurant Manager User row in the database.
      </p>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="display text-base font-semibold">Session</h2>
        <pre className="mt-3 max-h-[60vh] overflow-auto rounded-lg bg-muted p-3 text-xs">
          {JSON.stringify(session, null, 2)}
        </pre>
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-5">
        <h2 className="display text-base font-semibold">What to inspect</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground list-disc pl-5">
          <li>
            <code className="px-1 py-0.5 bg-muted rounded text-xs">user.id</code> — this is Authgear&apos;s
            internal user identifier (the OIDC <code className="px-1 py-0.5 bg-muted rounded text-xs">sub</code>).
            Stable across sessions and the key you&apos;d store on a Restaurant Manager User row to link the two.
          </li>
          <li>
            <code className="px-1 py-0.5 bg-muted rounded text-xs">user.email</code> /
            {' '}<code className="px-1 py-0.5 bg-muted rounded text-xs">user.name</code> — what Authgear
            passed through. Whether email is present depends on the login method + scopes you configured.
          </li>
          <li>
            If you can&apos;t see MFA-related claims here, that&apos;s expected — NextAuth flattens
            the OIDC response. To see the raw <code className="px-1 py-0.5 bg-muted rounded text-xs">amr</code>
            (auth methods used) you&apos;d add an{' '}
            <code className="px-1 py-0.5 bg-muted rounded text-xs">account</code> callback in auth.ts
            that exposes <code className="px-1 py-0.5 bg-muted rounded text-xs">account.id_token</code>
            and decode it.
          </li>
        </ul>
      </section>

      <section className="mt-6 flex flex-wrap gap-3">
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login/authgear' });
          }}
        >
          <button type="submit" className="rounded-full border px-4 py-2 text-sm hover:bg-accent">
            Sign out
          </button>
        </form>
        <Link
          href="/login/authgear"
          className="rounded-full border px-4 py-2 text-sm hover:bg-accent"
        >
          Back to sandbox
        </Link>
      </section>
    </div>
  );
}
