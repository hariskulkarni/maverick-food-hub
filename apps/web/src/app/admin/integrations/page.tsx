import { activeMembership } from '@/server/tenancy';
import { HelpButton } from '@/components/help/help-button';
import { NovaryqPanel } from './novaryq-panel';

export const metadata = { title: 'Admin · POS integration (Novaryq)' };
export const dynamic = 'force-dynamic';

/**
 * Novaryq POS integration for the active restaurant. Restaurant ADMIN only (membership
 * role); every API behind the panel re-checks that (novaryqAdminGate).
 */
export default async function AdminIntegrationsPage() {
  const m = await activeMembership();
  if (m?.role !== 'ADMIN') {
    return <div className="p-6 text-sm text-muted-foreground">Only a restaurant admin can manage the POS integration.</div>;
  }
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="display text-2xl sm:text-3xl font-semibold">POS integration · Novaryq</h1>
          <HelpButton appArea="admin.integrations" />
        </div>
        <p className="text-sm text-muted-foreground">
          Send every received Flavrly order to your Novaryq POS kitchen at Flavrly prices, follow kitchen progress back here,
          and keep sold-out items in sync. Orders on Flavrly never wait for the POS.
        </p>
      </header>
      <NovaryqPanel />
    </div>
  );
}
