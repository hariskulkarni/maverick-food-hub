import { NextRequest } from 'next/server';
import { parseMenuFile, diffMenuImport } from '@/server/menu-io';
import { resolveBranchScope } from './_helpers';

/**
 * POST /api/admin/menu/import
 * Accepts a multipart upload (field name `file`), parses it, and returns a
 * read-only diff (create/update/error per row) for the preview table.
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

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return new Response('Missing file upload (field name "file")', { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows;
  try {
    rows = await parseMenuFile(buffer, file.name);
  } catch (e) {
    return new Response((e as Error).message || 'Could not parse file', { status: 422 });
  }

  const diff = await diffMenuImport(scope.branchId, rows);
  // The engine returns `price` as a plain number, but normalise defensively in
  // case a Prisma Decimal ever flows through, so JSON is always serialisable.
  const safeDiff = diff.map((d) => ({
    ...d,
    price: d.price === undefined || d.price === null ? undefined : Number(d.price),
  }));

  const created = safeDiff.filter((d) => d.action === 'create').length;
  const updated = safeDiff.filter((d) => d.action === 'update').length;
  const errors = safeDiff.filter((d) => d.action === 'error').length;

  return Response.json({ rows, diff: safeDiff, summary: { created, updated, errors } });
}
