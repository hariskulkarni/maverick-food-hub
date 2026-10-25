/**
 * GET /api/platform/training-modules/report?audience=RIDER|KITCHEN|RESTAURANT_ADMIN|ALL[&format=csv]
 * Completion dashboard data (who completed what, pass rates, overdue). Contains
 * learner names/phones, so it needs `riders:read` on top of the console gate.
 */
import { NextRequest } from 'next/server';
import { requireCapabilityApi } from '@/server/api-auth';
import { buildTrainingReport, parseAudiences, reportToCsv } from '@/server/training/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireCapabilityApi('riders:read');
  if (gate instanceof Response) return gate;
  const audiences = parseAudiences(req.nextUrl.searchParams.get('audience'));
  const report = await buildTrainingReport({ audiences });
  if (req.nextUrl.searchParams.get('format') === 'csv') {
    return new Response(reportToCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="flavrly-training-${audiences.length === 1 ? audiences[0].toLowerCase() : 'all'}-${report.generatedAt.slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return Response.json(report);
}
