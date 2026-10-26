/**
 * POST /api/platform/app-releases/:id/activate — super-admin only.
 * Makes this release the live one for its platform/channel (any other active
 * release there is deactivated in the same transaction). Audited.
 */
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { ReleaseError, activateRelease, toAdminDto } from '@/server/app-releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;
  try {
    const { release, previous } = await activateRelease(id);
    await audit('app_release.activate', {
      actorId: gate.user.id,
      actorRole: 'SUPER_ADMIN',
      entityType: 'AppRelease',
      entityId: id,
      before: previous ? { activeReleaseId: previous.id, versionCode: previous.versionCode } : null,
      after: { activeReleaseId: release.id, versionCode: release.versionCode },
    });
    return Response.json({ release: toAdminDto(release) });
  } catch (e) {
    if (e instanceof ReleaseError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
