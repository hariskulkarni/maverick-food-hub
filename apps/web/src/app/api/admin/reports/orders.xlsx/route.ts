import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { ordersToXlsx } from '@/server/exports';

export async function GET() {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branchIds } = await requireAdminReportScope();
  const buf = await ordersToXlsx(branchIds);
  return new Response(new Uint8Array(buf as Buffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"` } });
}
