/**
 * POST /api/platform/app-releases/rollback — super-admin only.
 * Body: { platform: 'ANDROID'|'IOS', channel: 'STABLE'|'BETA' }
 * Re-activates the newest release older than the current active one. Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { parseOrJsonError } from '@/server/zod-helpers';
import { audit } from '@/server/audit';
import { ReleaseError, rollbackRelease, toAdminDto } from '@/server/app-releases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ platform: z.enum(['ANDROID', 'IOS']), channel: z.enum(['STABLE', 'BETA']) });

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  try {
    const { release, from } = await rollbackRelease(parsed.platform, parsed.channel);
    await audit('app_release.rollback', {
      actorId: gate.user.id,
      actorRole: 'SUPER_ADMIN',
      entityType: 'AppRelease',
      entityId: release.id,
      before: { activeReleaseId: from.id, versionCode: from.versionCode },
      after: { activeReleaseId: release.id, versionCode: release.versionCode },
    });
    return Response.json({ release: toAdminDto(release) });
  } catch (e) {
    if (e instanceof ReleaseError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
