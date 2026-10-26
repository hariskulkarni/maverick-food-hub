/**
 * POST /api/admin/onboarding/menu-template
 *   { templateId, selections?: [{ index, include, name?, price?, category? }] }
 *
 * Applies a cuisine starter template (with the owner's edits) to the active
 * branch through the SAME engine as CSV import (applyMenuImport), so category
 * creation, slug de-duplication and re-import updates behave identically.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit } from '@/server/audit';
import { log } from '@/server/log';
import { applyMenuImport } from '@/server/menu-io';
import { parseOrJsonError } from '@/server/zod-helpers';
import { resolveBranchScope } from '@/app/api/admin/menu/import/_helpers';
import { auth } from '@/server/auth';
import { auditMeta } from '@/server/onboarding-auth';
import { templateToMenuRows, TemplateError } from '@/lib/onboarding/menu-templates';
import { novaryqBulkImportLock } from '@/server/novaryq/menu-master';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  templateId: z.string().min(1).max(40),
  selections: z
    .array(z.object({
      index: z.number().int().min(0).max(200),
      include: z.boolean(),
      name: z.string().max(120).optional(),
      price: z.number().optional(),
      category: z.string().max(80).optional(),
    }))
    .max(200)
    .optional(),
});

export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = await resolveBranchScope(); // restaurant ADMIN + active restaurant + first active branch
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  if ('error' in scope) return scope.error;
  const lock = await novaryqBulkImportLock(scope.restaurantId);
  if (lock) return lock;

  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;

  let rows;
  try {
    rows = templateToMenuRows(parsed.templateId, parsed.selections ?? []);
  } catch (e) {
    if (e instanceof TemplateError) return Response.json({ error: e.message, reason: 'bad_template' }, { status: 400 });
    throw e;
  }

  let summary;
  try {
    summary = await applyMenuImport(scope.branchId, rows);
  } catch (e) {
    log.error({ err: e, branchId: scope.branchId }, 'onboarding template apply failed');
    return Response.json({ error: 'Adding the template failed — your menu is unchanged. Please retry.', reason: 'apply_failed' }, { status: 500 });
  }

  const session = await auth();
  await audit('menu.template.apply', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: scope.restaurantId,
    entityType: 'Branch',
    entityId: scope.branchId,
    after: { templateId: parsed.templateId, rows: rows.length, ...summary },
    ...auditMeta(req),
  });
  return Response.json({ ...summary, rows: rows.length });
}
