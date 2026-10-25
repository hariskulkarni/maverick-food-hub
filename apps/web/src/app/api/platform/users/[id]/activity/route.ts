/**
 * GET /api/platform/users/[id]/activity — SUPER_ADMIN only. Recent sessions
 * (device / IP / revoked reason) and audit events by or about the user, so a
 * super admin can see why someone is stuck (failed logins, lockouts, resets).
 */
import { NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/server/api-auth';
import { getUserActivity } from '@/server/platform-user-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  return Response.json(await getUserActivity(id), { headers: { 'Cache-Control': 'no-store' } });
}
