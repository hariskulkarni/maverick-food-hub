/**
 * Menu bulk import / export engine (CSV + Excel).
 *
 * Flow (matches the admin's mental model): bulk-import categories + items from
 * a flat one-row-per-item file, then customize each item (images, variants,
 * modifiers) afterward in the editor. So this engine deliberately handles ONLY
 * categories + base item fields — variants/modifiers are out of scope here and
 * added via their own UI.
 *
 * Three public capabilities:
 *   - parseMenuFile(buffer, filename)  → raw rows (CSV or .xlsx, header-mapped)
 *   - diffMenuImport(branchId, rows)   → preview: new / update / error per row
 *   - applyMenuImport(branchId, rows)  → upsert (auto-creates categories)
 *   - exportMenuWorkbook(branchId)     → xlsx buffer of the current menu
 *   - buildTemplateWorkbook(prefill)   → blank template OR pre-filled Indian
 *                                        catalog, as an xlsx buffer
 *
 * Matching for upsert: an item is identified by (category name, item name),
 * both case-insensitive, within the branch. Existing → update; absent → create.
 */

import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { prisma } from './db';
import { INDIAN_MENU_CATALOG } from './indian-menu-catalog';

// ── Column spec ──────────────────────────────────────────────────────────────
// Header → canonical field. Matching is case-insensitive + ignores spaces/_,
// so "Item Name", "item_name", "ITEMNAME" all map to `name`.
const COLUMN_ALIASES: Record<string, keyof MenuRow> = {
  category: 'category',
  categoryname: 'category',
  itemname: 'name',
  name: 'name',
  item: 'name',
  dish: 'name',
  description: 'description',
  desc: 'description',
  price: 'price',
  baseprice: 'price',
  veg: 'isVeg',
  vegnonveg: 'isVeg',
  isveg: 'isVeg',
  type: 'isVeg',
  spicylevel: 'spicyLevel',
  spice: 'spicyLevel',
  preptime: 'prepTimeMin',
  preptimemin: 'prepTimeMin',
  available: 'isAvailable',
  isavailable: 'isAvailable',
};

export interface MenuRow {
  category: string;
  name: string;
  description?: string;
  price?: number;
  isVeg?: boolean;
  spicyLevel?: number;
  prepTimeMin?: number;
  isAvailable?: boolean;
}

const TEMPLATE_HEADERS = [
  'Category', 'Item Name', 'Description', 'Price', 'Veg', 'Spicy Level', 'Prep Time (min)', 'Available',
];

function normalizeHeader(h: string): string {
  return String(h ?? '').toLowerCase().replace(/[\s_()-]+/g, '');
}

function parseVeg(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (['veg', 'yes', 'y', 'true', '1', 'vegetarian'].includes(s)) return true;
  if (['non-veg', 'nonveg', 'non veg', 'no', 'n', 'false', '0', 'nonvegetarian'].includes(s)) return false;
  return undefined;
}

function parseNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function parseBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'available'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'unavailable'].includes(s)) return false;
  return undefined;
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

/**
 * Extract the printable text of a cell, even when ExcelJS gives us back a
 * formula, hyperlink, or rich-text object instead of a primitive. Without
 * this, headers like a hyperlinked "Item Name" become an opaque object and
 * fail the COLUMN_ALIASES lookup — the original 'Forbidden / cannot match
 * Category & Item Name' class of bugs.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  const v = value as any;
  if (typeof v.text === 'string') return v.text; // hyperlink: { text, hyperlink }
  if (typeof v.result === 'string' || typeof v.result === 'number') return String(v.result); // formula
  if (Array.isArray(v.richText)) return v.richText.map((p: any) => p?.text ?? '').join(''); // rich text
  if (v instanceof Date) return v.toISOString();
  try { return String(v); } catch { return ''; }
}

/**
 * Find the worksheet to import from. We prefer the sheet literally named "Menu"
 * (matches the template), then the first VISIBLE sheet with data, then anything
 * non-empty. This is what saves users who downloaded the template, edited the
 * "How to use" sheet by mistake, or rearranged tabs.
 */
function pickDataSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  if (wb.worksheets.length === 0) return null;
  const byName = wb.getWorksheet('Menu');
  if (byName && byName.rowCount > 0) return byName;
  for (const ws of wb.worksheets) {
    // ExcelJS uses `state: 'visible' | 'hidden' | 'veryHidden'`. Default is visible.
    const visible = (ws as any).state == null || (ws as any).state === 'visible';
    if (visible && ws.rowCount > 0) return ws;
  }
  return wb.worksheets[0] ?? null;
}

/**
 * Locate the header row. Most users keep headers on row 1, but a surprising
 * number paste a title/banner row above, or leave a blank row before headers.
 * We scan the first 5 rows for the one that has BOTH a Category and an
 * Item Name alias — that's the real header.
 */
function findHeaderRow(ws: ExcelJS.Worksheet): { rowNumber: number; colMap: Map<number, keyof MenuRow> } | null {
  const scanLimit = Math.min(5, ws.rowCount);
  for (let r = 1; r <= scanLimit; r++) {
    const row = ws.getRow(r);
    const colMap = new Map<number, keyof MenuRow>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const field = COLUMN_ALIASES[normalizeHeader(cellText(cell.value))];
      if (field) colMap.set(colNumber, field);
    });
    const fields = new Set(colMap.values());
    if (fields.has('category') && fields.has('name')) {
      return { rowNumber: r, colMap };
    }
  }
  return null;
}

/**
 * Parse a CSV or .xlsx buffer into raw MenuRows. Resilient to:
 *   - the header being on row 2 or 3 (banner row above), within the first 5 rows;
 *   - the data sheet not being the first tab (looks for a sheet named "Menu");
 *   - hyperlinked / formula / rich-text headers;
 *   - blank rows interspersed throughout the data;
 *   - corrupted/encrypted .xlsx (clean error instead of an opaque crash).
 *
 * Throws an Error with a USER-FACING message — the route turns that into a
 * 422 toast.
 */
export async function parseMenuFile(buffer: Buffer, filename: string): Promise<MenuRow[]> {
  const wb = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith('.csv');
  try {
    if (isCsv) {
      const stream = Readable.from(buffer.toString('utf8'));
      await wb.csv.read(stream);
    } else {
      await wb.xlsx.load(buffer as any);
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    // ExcelJS throws "End of central directory record signature not found" for
    // non-xlsx blobs (e.g. .xls, .numbers, a renamed PDF). Translate.
    if (/central directory/i.test(msg) || /not a valid zip/i.test(msg)) {
      throw new Error('That file isn\'t a valid .xlsx workbook. If it\'s an older .xls, open it in Excel and "Save As .xlsx" first.');
    }
    if (/encrypted/i.test(msg) || /password/i.test(msg)) {
      throw new Error('This workbook is password-protected. Remove the password and re-upload.');
    }
    throw new Error('Could not read that file. Try re-saving it from Excel/Sheets and uploading again.');
  }

  const ws = pickDataSheet(wb);
  if (!ws) throw new Error('The file has no worksheet/data.');

  const header = findHeaderRow(ws);
  if (!header) {
    throw new Error(
      'No header row found. The sheet needs columns named "Category" and "Item Name" within the first 5 rows. ' +
        'Download the blank template if you need a fresh start.'
    );
  }

  const rows: MenuRow[] = [];
  for (let r = header.rowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: Record<string, unknown> = {};
    header.colMap.forEach((field, colNumber) => {
      raw[field] = row.getCell(colNumber).value;
    });
    const category = cellText(raw.category).trim();
    const name = cellText(raw.name).trim();
    if (!category && !name) continue; // skip blank rows
    rows.push({
      category,
      name,
      description: raw.description != null ? cellText(raw.description).trim() : undefined,
      price: parseNum(cellText(raw.price)),
      isVeg: parseVeg(cellText(raw.isVeg)),
      spicyLevel: parseNum(cellText(raw.spicyLevel)),
      prepTimeMin: parseNum(cellText(raw.prepTimeMin)),
      isAvailable: parseBool(cellText(raw.isAvailable)),
    });
  }
  return rows;
}

export type RowAction = 'create' | 'update' | 'error';
export interface DiffRow {
  index: number; // 1-based row position in the file (data rows)
  action: RowAction;
  category: string;
  name: string;
  price?: number;
  isVeg?: boolean;
  errors: string[];
}

/**
 * Validate rows + classify each as create / update / error against the branch's
 * current menu. Read-only — no DB writes. Match key: (category, name) lower.
 */
export async function diffMenuImport(branchId: string, rows: MenuRow[]): Promise<DiffRow[]> {
  // Existing items keyed by `${categorySlug}::${nameLower}` for fast lookup.
  const existing = await prisma.menuItem.findMany({
    where: { branchId },
    select: { name: true, category: { select: { name: true } } },
  });
  const existingKeys = new Set(
    existing.map((i) => `${i.category.name.toLowerCase()}::${i.name.toLowerCase()}`)
  );

  return rows.map((row, i) => {
    const errors: string[] = [];
    if (!row.category) errors.push('Missing category');
    if (!row.name) errors.push('Missing item name');
    if (row.price === undefined) errors.push('Missing or invalid price');
    else if (row.price < 0) errors.push('Price cannot be negative');
    if (row.spicyLevel !== undefined && (row.spicyLevel < 0 || row.spicyLevel > 3)) {
      errors.push('Spicy level must be 0–3');
    }
    const key = `${row.category.toLowerCase()}::${row.name.toLowerCase()}`;
    const action: RowAction = errors.length ? 'error' : existingKeys.has(key) ? 'update' : 'create';
    return { index: i + 1, action, category: row.category, name: row.name, price: row.price, isVeg: row.isVeg, errors };
  });
}

export interface ApplyResult {
  created: number;
  updated: number;
  skipped: number;
  categoriesCreated: number;
}

/**
 * Apply an import: upsert categories + items. Error rows are skipped. Runs in a
 * transaction so a mid-file failure rolls back cleanly.
 */
export async function applyMenuImport(branchId: string, rows: MenuRow[]): Promise<ApplyResult> {
  const diff = await diffMenuImport(branchId, rows);
  const result: ApplyResult = { created: 0, updated: 0, skipped: 0, categoriesCreated: 0 };

  await prisma.$transaction(async (tx) => {
    // Resolve/create categories up front (cache by lower name).
    const catCache = new Map<string, string>(); // nameLower → categoryId
    const existingCats = await tx.category.findMany({ where: { branchId }, select: { id: true, name: true, sortOrder: true } });
    let maxCatSort = existingCats.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    for (const c of existingCats) catCache.set(c.name.toLowerCase(), c.id);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const d = diff[i];
      if (d.action === 'error') { result.skipped++; continue; }

      // Category.
      let categoryId = catCache.get(row.category.toLowerCase());
      if (!categoryId) {
        const created = await tx.category.create({
          data: { branchId, name: row.category, slug: slugify(row.category), sortOrder: ++maxCatSort },
        });
        categoryId = created.id;
        catCache.set(row.category.toLowerCase(), categoryId);
        result.categoriesCreated++;
      }

      // Item — match existing by (branch, category, name).
      const found = await tx.menuItem.findFirst({
        where: { branchId, categoryId, name: { equals: row.name, mode: 'insensitive' } },
        select: { id: true },
      });
      const data = {
        name: row.name,
        description: row.description ?? null,
        price: (row.price ?? 0) as any,
        isVeg: row.isVeg ?? true,
        spicyLevel: row.spicyLevel ?? 0,
        prepTimeMin: row.prepTimeMin ?? 20,
        isAvailable: row.isAvailable ?? true,
      };
      if (found) {
        await tx.menuItem.update({ where: { id: found.id }, data });
        result.updated++;
      } else {
        await tx.menuItem.create({
          data: { ...data, branchId, categoryId, slug: slugify(row.name) },
        });
        result.created++;
      }
    }
  }, { timeout: 30_000 });

  return result;
}

// ── Export + templates ───────────────────────────────────────────────────────

function writeSheet(ws: ExcelJS.Worksheet, rows: (string | number)[][]) {
  ws.addRow(TEMPLATE_HEADERS);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c) => { c.width = 20; });
  ws.getColumn(3).width = 40; // description
}

/** Export the branch's current menu to an xlsx buffer (one row per item). */
export async function exportMenuWorkbook(branchId: string): Promise<Buffer> {
  const items = await prisma.menuItem.findMany({
    where: { branchId },
    include: { category: { select: { name: true, sortOrder: true } } },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Menu');
  writeSheet(ws, items.map((i) => [
    i.category.name, i.name, i.description ?? '', Number(i.price),
    i.isVeg ? 'Veg' : 'Non-Veg', i.spicyLevel, i.prepTimeMin, i.isAvailable ? 'Yes' : 'No',
  ]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Build a downloadable template. prefill=true fills it with the curated Indian
 * catalog (admin edits + imports); prefill=false is a blank header-only sheet.
 */
export async function buildTemplateWorkbook(prefill: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Menu');
  const rows = prefill
    ? INDIAN_MENU_CATALOG.map((c) => [
        c.category, c.name, c.description ?? '', c.basePrice,
        c.isVeg ? 'Veg' : 'Non-Veg', 1, 20, 'Yes',
      ])
    : [];
  writeSheet(ws, rows);
  // A tiny instructions sheet so the admin knows the rules.
  const help = wb.addWorksheet('How to use');
  help.addRow(['Restaurant Manager — Menu import template']);
  help.addRow([]);
  help.addRow(['• One row per menu item. Category + Item Name + Price are required.']);
  help.addRow(['• Categories are created automatically if they don\'t exist yet.']);
  help.addRow(['• Veg column: "Veg" or "Non-Veg". Available: "Yes" or "No".']);
  help.addRow(['• Spicy Level: 0 (none) to 3 (very spicy).']);
  help.addRow(['• Re-importing updates existing items (matched by category + name).']);
  help.addRow(['• Add images, sizes/variants and add-ons AFTER import, in the item editor.']);
  help.getRow(1).font = { bold: true, size: 14 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
