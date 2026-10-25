/** POST /api/platform/help/articles/[id]/versions/[versionId]/restore — restore as a new version. SUPER_ADMIN only. */
import { requireSuperAdminApi } from '@/server/api-auth';
import { restoreVersion } from '@/server/help/authoring';
import { actorOf, articleDto } from '../../../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id, versionId } = await params;
  const a = await restoreVersion(id, versionId, actorOf(gate));
  if (!a) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ article: articleDto(a) });
}
