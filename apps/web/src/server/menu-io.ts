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
 * Parse a CSV or .xlsx buffer into raw MenuRows. The first non-empty row is
 * the header; subsequent rows map by the COLUMN_ALIASES table. Throws on a
 * file with no recognisable Category/Item columns.
 */
export async function parseMenuFile(buffer: Buffer, filename: string): Promise<MenuRow[]> {
  const wb = new ExcelJS.Workbook();
  const isCsv = filename.toLowerCase().endsWith('.csv');
  if (isCsv) {
    const stream = Readable.from(buffer.toString('utf8'));
    await wb.csv.read(stream);
  } else {
    await wb.xlsx.load(buffer as any);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The file has no worksheet/data');

  // Build header → column-index map from row 1.
  const headerRow = ws.getRow(1);
  const colMap = new Map<number, keyof MenuRow>();
  headerRow.eachCell((cell, colNumber) => {
    const field = COLUMN_ALIASES[normalizeHeader(String(cell.value ?? ''))];
    if (field) colMap.set(colNumber, field);
  });
  const fields = new Set(colMap.values());
  if (!fields.has('category') || !fields.has('name')) {
    throw new Error('File must have at least "Category" and "Item Name" columns');
  }

  const rows: MenuRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: Record<string, unknown> = {};
    colMap.forEach((field, colNumber) => {
      raw[field] = row.getCell(colNumber).value;
    });
    const category = String(raw.category ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!category && !name) continue; // skip blank rows
    rows.push({
      category,
      name,
      description: raw.description != null ? String(raw.description).trim() : undefined,
      price: parseNum(raw.price),
      isVeg: parseVeg(raw.isVeg),
      spicyLevel: parseNum(raw.spicyLevel),
      prepTimeMin: parseNum(raw.prepTimeMin),
      isAvailable: parseBool(raw.isAvailable),
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
