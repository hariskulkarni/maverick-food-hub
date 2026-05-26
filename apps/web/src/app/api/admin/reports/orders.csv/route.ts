import { auth } from '@/server/auth';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { ordersToCsv } from '@/server/exports';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branchIds } = await requireAdminReportScope();
  const csv = await ordersToCsv(branchIds);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
