import { ShieldAlert } from 'lucide-react';
import { ObservabilityClient } from './observability-client';
import { observabilityPageDenial } from '@/server/observability/access';

export const metadata = { title: 'Platform · Observability' };
export const dynamic = 'force-dynamic';

export default async function ObservabilityPage() {
  // Server-side gate (the middleware already limits /platform/observability to
  // SUPER_ADMIN; this additionally requires a 2FA session).
  const denial = await observabilityPageDenial();
  if (denial) {
    return (
      <div className="p-4 sm:p-6 max-w-xl">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
          <div>
            <h1 className="text-lg font-semibold">Observability is restricted</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {denial === '2fa'
                ? 'This console requires a platform super-admin session signed in with Google Authenticator (2FA). Sign out and sign in again with your authenticator code. Break-glass logins cannot open it.'
                : 'Only platform super-admins can open the Observability Center.'}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1400px]">
      <header>
        <h1 className="display text-3xl font-semibold">Observability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every request, error, job, notification, order, rider and dependency — one place. Super-admin only.
        </p>
      </header>
      <ObservabilityClient />
    </div>
  );
}
