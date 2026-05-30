/**
 * POST /api/admin/menu/import
 *
 * Bulk-import PREVIEW. Reads the uploaded CSV/.xlsx, classifies each row as
 * create / update / error against the active branch's current menu, and
 * returns a read-only diff for the confirmation table. The actual write
 * happens in /apply with the rows the admin confirmed.
 *
 * Error responses are JSON `{ error, reason? }` so the panel can render an
 * actionable toast (re-sign-in, link to /admin/branches, etc.) instead of
 * just a raw status line.
 */
import { NextRequest } from 'next/server';
import { parseMenuFile, diffMenuImport } from '@/server/menu-io';
import { resolveBranchScope } from './_helpers';

// Upload size guard. xlsx files balloon fast once a sheet has formatting; a
// 10 MB cap is generous for menu data (hundreds of items) but stops anyone
// from accidentally uploading a corrupted gigabyte-sized file.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let scope;
  try {
    scope = await resolveBranchScope();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  if ('error' in scope) return scope.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: 'Could not read the upload. Try again.', reason: 'bad_form' },
      { status: 400 }
    );
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json(
      { error: 'No file attached. Choose a CSV or .xlsx file and retry.', reason: 'no_file' },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return Response.json(
      { error: 'The file is empty.', reason: 'empty_file' },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB — limit is 10 MB. Trim sheets or split into batches.`, reason: 'too_large' },
      { status: 413 }
    );
  }

  // Reject obviously-wrong file types BEFORE invoking ExcelJS, so the user
  // gets a fast, friendly hint instead of a parser stack trace. ExcelJS's
  // errors for non-spreadsheet inputs are not great UX.
  const lowerName = file.name.toLowerCase();
  const ok = lowerName.endsWith('.csv') || lowerName.endsWith('.xlsx');
  if (!ok) {
    return Response.json(
      { error: 'Unsupported file type. Upload a .csv or .xlsx (use the blank template if unsure).', reason: 'wrong_type' },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows;
  try {
    rows = await parseMenuFile(buffer, file.name);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || 'Could not read that file.', reason: 'parse' },
      { status: 422 }
    );
  }

  if (rows.length === 0) {
    return Response.json({
      rows: [],
      diff: [],
      summary: { created: 0, updated: 0, errors: 0 },
      restaurant: { id: scope.restaurantId, name: scope.restaurantName },
      notice: 'No rows found in that file.',
    });
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

  return Response.json({
    rows,
    diff: safeDiff,
    summary: { created, updated, errors },
    restaurant: { id: scope.restaurantId, name: scope.restaurantName },
  });
}
