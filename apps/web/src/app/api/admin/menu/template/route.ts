import { NextRequest } from 'next/server';
import { buildTemplateWorkbook } from '@/server/menu-io';
import { resolveBranchScope } from '../import/_helpers';

/**
 * GET /api/admin/menu/template[?prefill=indian]
 * Returns a blank import template, or one pre-filled with the Indian catalog
 * when `?prefill=indian`, as an .xlsx attachment.
 */
export async function GET(req: NextRequest) {
  let scope;
  try {
    scope = await resolveBranchScope();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  if ('error' in scope) return scope.error;

  const prefill = req.nextUrl.searchParams.get('prefill') === 'indian';
  const buffer = await buildTemplateWorkbook(prefill);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="menu-template.xlsx"',
    },
  });
}
