/**
 * /platform/app-releases — publish and manage rider app builds (SUPER_ADMIN).
 * Upload an APK (private storage, server-side SHA-256) or register an external
 * link, activate, deactivate and roll back. Riders get the active stable
 * Android build from /download/rider-app; the app checks /api/app/rider/latest.
 */
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { RIDER_APP, toAdminDto } from '@/server/app-releases';
import { AppReleasesClient } from './app-releases-client';

export const metadata = { title: 'Platform · Rider app releases' };
export const dynamic = 'force-dynamic';

export default async function AppReleasesPage() {
  await requireSuperAdmin();
  const rows = await prisma.appRelease.findMany({
    where: { app: RIDER_APP },
    orderBy: [{ platform: 'asc' }, { channel: 'asc' }, { versionCode: 'desc' }],
    take: 200,
  });
  return (
    <div className="max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="display text-3xl font-semibold">Rider app releases</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Publish a new Flavrly Rider build. The active <strong>stable Android</strong> release is what riders download from{' '}
          <code className="rounded bg-muted px-1">/download/rider-app</code> (rider-app page, rider portal, help center), and what the
          installed app compares itself against to show “Update available” / “Update required”.
        </p>
      </header>
      <AppReleasesClient initial={rows.map(toAdminDto)} />
    </div>
  );
}
