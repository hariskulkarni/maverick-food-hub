import { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyMenuImport, type MenuRow } from '@/server/menu-io';
import { resolveBranchScope } from '../_helpers';

const RowSchema = z.object({
  category: z.string(),
  name: z.string(),
  description: z.string().optional(),
  price: z.number().optional(),
  isVeg: z.boolean().optional(),
  spicyLevel: z.number().optional(),
  prepTimeMin: z.number().optional(),
  isAvailable: z.boolean().optional(),
});
const Body = z.object({ rows: z.array(RowSchema) });

/**
 * POST /api/admin/menu/import/apply
 * Accepts the confirmed rows and upserts them via the import engine.
 */
export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = await resolveBranchScope();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  if ('error' in scope) return scope.error;

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return new Response('Invalid request body', { status: 400 });
  }

  const summary = await applyMenuImport(scope.branchId, parsed.rows as MenuRow[]);
  return Response.json(summary);
}
