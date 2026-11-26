/**
 * Maintenance flag, for Edge middleware.
 *
 * Middleware runs on the Edge runtime and cannot reach Prisma, so it reads the
 * flag over HTTP from here (with its own few-second cache — see
 * `middleware.ts`). This endpoint MUST stay exempt from the maintenance gate
 * itself, or the gate would be unable to learn its own state.
 *
 * Public and unauthenticated by design: it has to answer while the site is
 * closed, and it reveals nothing beyond what every visitor already sees on the
 * holding page. `by` (the operator who flipped it) is deliberately NOT exposed.
 */
import { getMaintenance } from '@/server/maintenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const m = await getMaintenance();
  return Response.json(
    { on: m.on, message: m.message, since: m.since },
    { headers: { 'Cache-Control': 'no-store, max-age=0', 'CDN-Cache-Control': 'no-store' } },
  );
}
