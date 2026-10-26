import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { resolveException } from '@/server/pg/exceptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  resolution: z.string().trim().min(1).max(2000),
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED']).default('RESOLVED'),
});

/** SUPER_ADMIN: acknowledge or resolve a reconciliation exception (actor + written resolution). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A resolution note is required.' }, { status: 400 });
  try {
    const out = await resolveException({
      exceptionId: id,
      actorId: gate.user.id,
      resolution: parsed.data.resolution,
      status: parsed.data.status,
    });
    await audit(`pg.exception.${parsed.data.status.toLowerCase()}`, {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgReconException',
      entityId: id,
      after: { status: out.status, resolution: parsed.data.resolution },
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
