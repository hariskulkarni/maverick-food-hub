import { exportMenuWorkbook } from '@/server/menu-io';
import { resolveBranchScope } from '../import/_helpers';

/**
 * GET /api/admin/menu/export
 * Streams the branch's current menu as an .xlsx attachment.
 */
export async function GET() {
  let scope;
  try {
    scope = await resolveBranchScope();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  if ('error' in scope) return scope.error;

  const buffer = await exportMenuWorkbook(scope.branchId);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="menu.xlsx"',
    },
  });
}
