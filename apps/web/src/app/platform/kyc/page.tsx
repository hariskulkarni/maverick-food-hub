import { requireSuperAdmin } from '@/server/tenancy';
import { KycQueueClient } from './kyc-queue-client';

export const metadata = { title: 'Platform · KYC review' };
export const dynamic = 'force-dynamic';

export default async function PlatformKycPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; type?: string; q?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <header>
        <h1 className="display text-3xl font-semibold">KYC review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve, reject, or expire rider identity documents. All actions are logged in the audit trail.
        </p>
      </header>
      <KycQueueClient
        filters={{
          status: (sp.status || '').toUpperCase(),
          type: (sp.type || '').toUpperCase(),
          q: sp.q ?? ''
        }}
      />
    </div>
  );
}
