import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireCapability } from '@/server/tenancy';
import { buildTrainingReport, parseAudiences } from '@/server/training/report';
import { TrainingDashboardClient } from './dashboard-client';

export const metadata = { title: 'Platform · Training completion' };
export const dynamic = 'force-dynamic';

export default async function TrainingDashboardPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  // Learner names + phones → riders:read on top of the console's cms:read.
  const session = await requireCapability('riders:read');
  const audienceParam = (await searchParams).audience ?? 'RIDER';
  const audiences = parseAudiences(audienceParam);
  const report = await buildTrainingReport({ audiences });
  return (
    <div className="max-w-7xl space-y-6 p-4 sm:p-6">
      <Link href="/platform/training-modules" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Training library
      </Link>
      <header>
        <h1 className="display text-3xl font-semibold">Training completion</h1>
        <p className="mt-1 text-sm text-muted-foreground">Who completed what, pass rates on the current version, and overdue required modules.</p>
      </header>
      <TrainingDashboardClient
        report={JSON.parse(JSON.stringify(report))}
        audience={audiences.length === 1 ? audiences[0] : 'ALL'}
        canReset={session.user.role === 'SUPER_ADMIN'}
      />
    </div>
  );
}
