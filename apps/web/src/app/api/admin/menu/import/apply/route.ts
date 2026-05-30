/**
 * POST /api/admin/menu/import/apply
 *
 * Persist the rows the admin confirmed in the preview step. Mirrors the
 * preview route's JSON error shape (`{ error, reason }`) so the panel can
 * surface the same actionable toasts for auth / scope failures.
 */
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
const Body = z.object({ rows: z.array(RowSchema).min(1).max(5000) });

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
    return Response.json(
      { error: 'Invalid request body. Re-preview the file and retry.', reason: 'bad_body' },
      { status: 400 }
    );
  }

  try {
    const summary = await applyMenuImport(scope.branchId, parsed.rows as MenuRow[]);
    return Response.json(summary);
  } catch (e) {
    // applyMenuImport runs in a transaction — anything that bubbles out is a
    // DB-level failure (constraint, timeout). Don't leak the raw message, but
    // give the operator a usable hint.
    return Response.json(
      { error: 'Saving the import failed mid-way. The menu is unchanged. Check the rows and retry.', reason: 'apply_failed' },
      { status: 500 }
    );
  }
}
