/**
 * GET /api/staff/training/team[?format=csv] — restaurant ADMIN only: training
 * status of the staff linked to the admin's CURRENT restaurant (tenancy via
 * currentRestaurant()); never other restaurants, never riders.
 */
import { NextRequest } from 'next/server';
import { staffLearner } from '@/server/training/learner-auth';
import { forbidden } from '@/server/api-auth';
import { buildTrainingReport, reportToCsv } from '@/server/training/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await staffLearner(null);
  if (who instanceof Response) return who;
  if (who.learner.role !== 'ADMIN') return forbidden('Only a restaurant admin can view team training.');
  const report = await buildTrainingReport({ audiences: ['KITCHEN', 'RESTAURANT_ADMIN'], restaurantId: who.restaurantId });
  if (req.nextUrl.searchParams.get('format') === 'csv') {
    return new Response(reportToCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="team-training-${report.generatedAt.slice(0, 10)}.csv"`,
      },
    });
  }
  return Response.json(report);
}
