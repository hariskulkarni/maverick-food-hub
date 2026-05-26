import { auth } from '@/server/auth';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { ordersToXlsx } from '@/server/exports';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branchIds } = await requireAdminReportScope();
  const buf = await ordersToXlsx(branchIds);
  return new Response(new Uint8Array(buf as Buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"` } });
}
