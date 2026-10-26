import { ShieldAlert, FlaskConical } from 'lucide-react';
import { superAdmin2faSession } from '@/server/observability/access';
import { TestAccountsClient } from './test-accounts-client';

export const metadata = { title: 'Platform · Test accounts' };
export const dynamic = 'force-dynamic';

export default async function TestAccountsPage() {
  // Middleware limits /platform/users/** to SUPER_ADMIN; this additionally
  // requires a 2FA (Google Authenticator) session, like the Observability Center.
  const r = await superAdmin2faSession();
  if (!('ok' in r)) {
    return (
      <div className="p-4 sm:p-6 max-w-xl">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
          <div>
            <h1 className="text-lg font-semibold">Test accounts are restricted</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.deny === '2fa'
                ? 'Managing test accounts requires a platform super-admin session signed in with Google Authenticator (2FA). Sign out and sign in again with your authenticator code.'
                : 'Only platform super-admins can manage test accounts.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">
      <header>
        <h1 className="display text-2xl sm:text-3xl font-semibold flex items-center gap-2">
          <FlaskConical className="size-6 sm:size-7 text-primary" /> Test accounts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pre-launch customer and rider accounts whose login code is shown on screen instead of sent by SMS.
          Test riders only ever get orders from test customers. Delete them before launch.
        </p>
      </header>
      <TestAccountsClient />
    </div>
  );
}
