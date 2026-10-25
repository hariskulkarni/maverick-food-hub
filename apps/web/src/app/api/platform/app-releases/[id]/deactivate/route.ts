/**
 * POST /api/platform/app-releases/:id/deactivate — super-admin only.
 * Takes a release offline (no active release → the download page says the app
 * is temporarily unavailable). Audited.
 */
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { ReleaseError, deactivateRelease, toAdminDto } from '@/server/app-releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;
  try {
    const release = await deactivateRelease(id);
    await audit('app_release.deactivate', {
      actorId: gate.user.id,
      actorRole: 'SUPER_ADMIN',
      entityType: 'AppRelease',
      entityId: id,
      after: { versionCode: release.versionCode, isActive: false },
    });
    return Response.json({ release: toAdminDto(release) });
  } catch (e) {
    if (e instanceof ReleaseError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
