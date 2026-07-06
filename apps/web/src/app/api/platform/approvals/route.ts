import { prisma } from '@/server/db';
import { requireCapabilityApi } from '@/server/api-auth';
import { can } from '@/server/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET — list approval requests. A reviewer (SUPER_ADMIN, `approvals:review`)
 * sees every request; a requester sees only their own.
 */
export async function GET() {
  const gate = await requireCapabilityApi('platform:view');
  if (gate instanceof Response) return gate;
  const session = gate;
  const role = (session.user as { role?: string }).role;
  const reviewer = can(role, 'approvals:review');

  const requests = await prisma.approvalRequest.findMany({
    where: reviewer ? {} : { requestedById: session.user.id },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      requestedBy: { select: { name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
    },
  });

  return Response.json({ reviewer, requests });
}
