/**
 * Novaryq menu sync (CONTRACT §5 "Menu"): connection test, location currency
 * check, menu import (reuses the spreadsheet importer, plus modifier groups),
 * item linking + name auto-match, availability (86 / un-86) and the periodic
 * reconcile fallback.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { applyMenuImport, type MenuRow } from '../menu-io';
import { NovaryqApiError, novaryqRequest, type NovaryqCredentials } from './client';
import { loadNovaryqConfig, novaryqFlagOn } from './config';

export interface NovaryqModifierGroup {
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: Array<{ name: string; price: number; available: boolean; isDefault: boolean }>;
}

export interface NovaryqMenuItem {
  itemCode: string;
  name: string;
  price: number | null;
  currency: string | null;
  available: boolean;
  categoryName: string | null;
  modifierGroups: NovaryqModifierGroup[];
}

const count = (v: unknown, dflt: number) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : dflt);

/** `modifierGroups` of a GET /menu item; nameless groups/options are dropped, an option's maxQuantity is not modelled on Flavrly. */
function parseModifierGroups(raw: unknown): NovaryqModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: NovaryqModifierGroup[] = [];
  for (const g of raw as Array<Record<string, unknown>>) {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) continue;
    const options = (Array.isArray(g.options) ? (g.options as Array<Record<string, unknown>>) : [])
      .filter((o) => o && typeof o.name === 'string' && o.name.trim())
      .map((o) => {
        const price = Number(o.price ?? 0);
        return { name: (o.name as string).trim(), price: Number.isFinite(price) ? price : 0, available: o.available !== false, isDefault: o.isDefault === true };
      });
    groups.push({ name: g.name.trim(), minSelect: count(g.minSelect, 0), maxSelect: count(g.maxSelect, 1), required: g.required === true, options });
  }
  return groups;
}

/** GET /menu[?locationId] → normalized items (accepts `category` for older Novaryq builds). */
export async function fetchNovaryqMenu(creds: NovaryqCredentials, locationId?: string): Promise<{ items: NovaryqMenuItem[]; currency: string | null }> {
  const q = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
  const res = await novaryqRequest<{ data?: unknown[]; currency?: unknown }>(creds, 'GET', `/menu${q}`);
  const rows = Array.isArray(res.data?.data) ? res.data!.data : [];
  const items: NovaryqMenuItem[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const itemCode = typeof r.itemCode === 'string' ? r.itemCode : null;
    if (!itemCode || typeof r.name !== 'string') continue;
    const price = r.price === null || r.price === undefined ? null : Number(r.price);
    items.push({
      itemCode,
      name: r.name,
      price: price !== null && Number.isFinite(price) ? price : null,
      currency: typeof r.currency === 'string' ? r.currency : null,
      available: r.available !== false,
      categoryName: typeof r.categoryName === 'string' ? r.categoryName : typeof r.category === 'string' ? r.category : null,
      modifierGroups: parseModifierGroups(r.modifierGroups),
    });
  }
  return { items, currency: typeof res.data?.currency === 'string' ? res.data.currency : null };
}

function apiError(e: unknown): string {
  if (e instanceof NovaryqApiError) {
    if (e.status === 401) return 'Novaryq rejected the API key or secret (HTTP 401).';
    if (e.status === 403) return 'The Novaryq API key lacks a required scope (read:menu, write:orders, read:orders) (HTTP 403).';
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Integration test(): a signed GET /menu (novaryqRequest applies the base-URL guard).
 * Flavrly connects only to Novaryq India tenants (ADR-FNI-001 §1.4): any non-INR currency
 * in the tenant-wide menu refuses the connection (a mixed tenant answers currency null, so
 * item currencies are checked too; every linked location is checked again on linking).
 */
export async function testNovaryqConnection(creds: NovaryqCredentials): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    const menu = await fetchNovaryqMenu(creds);
    const foreign = [...new Set([menu.currency, ...menu.items.map((i) => i.currency)].filter((c): c is string => !!c && c.toUpperCase() !== 'INR'))];
    if (foreign.length) {
      return { ok: false, error: `This Novaryq account sells in ${foreign.join(', ')}. Flavrly connects only to Novaryq India (INR) accounts — use your novaryq.in account's API key.` };
    }
    return { ok: true, detail: `Connected to Novaryq. ${menu.items.length} menu items visible to this API key.` };
  } catch (e) {
    return { ok: false, error: apiError(e) };
  }
}

/** Refuses a location whose currency is not INR (or cannot be confirmed). */
export async function checkLocationCurrency(creds: NovaryqCredentials, locationId: string): Promise<{ ok: true; currency: 'INR'; itemCount: number } | { ok: false; error: string }> {
  let menu;
  try {
    menu = await fetchNovaryqMenu(creds, locationId);
  } catch (e) {
    return { ok: false, error: apiError(e) };
  }
  const currencies = new Set([menu.currency, ...menu.items.map((i) => i.currency)].filter((c): c is string => !!c));
  if (currencies.size === 0) {
    return { ok: false, error: 'Could not confirm this Novaryq location uses INR: it returned no priced menu items. Publish its menu in Novaryq first.' };
  }
  const other = [...currencies].filter((c) => c.toUpperCase() !== 'INR');
  if (other.length) return { ok: false, error: `This Novaryq location uses ${other.join(', ')}. Flavrly sells in INR only, so it cannot be linked.` };
  return { ok: true, currency: 'INR', itemCount: menu.items.length };
}

export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── Availability ─────────────────────────────────────────────────────────────

export async function applyAvailabilityEvent(ev: {
  restaurantId: string;
  itemCode: string;
  available: boolean;
  locationId: string | null;
  occurredAt: Date;
}): Promise<'applied' | 'noop' | 'ignored:unlinked' | 'ignored:other_location' | 'ignored:stale'> {
  let links = await prisma.novaryqItemLink.findMany({
    where: { restaurantId: ev.restaurantId, novaryqItemCode: ev.itemCode },
    select: { id: true, menuItemId: true, menuItem: { select: { branchId: true, isAvailable: true } } },
  });
  if (links.length === 0) return 'ignored:unlinked';
  if (ev.locationId) {
    // Location-scoped event: only branches linked to that Novaryq location.
    const locs = await prisma.novaryqLocationLink.findMany({
      where: { restaurantId: ev.restaurantId, novaryqLocationId: ev.locationId },
      select: { branchId: true },
    });
    const branches = new Set(locs.map((l) => l.branchId));
    links = links.filter((l) => branches.has(l.menuItem.branchId));
    if (links.length === 0) return 'ignored:other_location';
  }
  const occurredAt = Number.isNaN(ev.occurredAt.getTime()) ? new Date() : ev.occurredAt;
  let applied = 0;
  let fresh = 0;
  for (const link of links) {
    const guard = await prisma.novaryqItemLink.updateMany({
      where: { id: link.id, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: occurredAt } }] },
      data: { lastSyncedAt: occurredAt },
    });
    if (guard.count === 0) continue; // an older event than the last one applied to this item
    fresh++;
    if (link.menuItem.isAvailable === ev.available) continue;
    await prisma.menuItem.update({ where: { id: link.menuItemId }, data: { isAvailable: ev.available } });
    applied++;
  }
  if (applied) log.info({ itemCode: ev.itemCode, available: ev.available, items: applied }, 'novaryq.menu.availability');
  return applied ? 'applied' : fresh ? 'noop' : 'ignored:stale';
}

// ── Import + linking ─────────────────────────────────────────────────────────

async function requireLocation(restaurantId: string, branchId: string) {
  const loc = await prisma.novaryqLocationLink.findFirst({ where: { restaurantId, branchId } });
  if (!loc) throw new Error('Link this branch to a Novaryq location first.');
  return loc;
}

async function requireConfig(restaurantId: string) {
  const cfg = await loadNovaryqConfig(restaurantId);
  if (!cfg) throw new Error('Connect Novaryq first (credentials are missing or the last test failed).');
  return cfg;
}

/** Links (or with null unlinks) a Flavrly item of this restaurant to a Novaryq item code. */
export async function linkItem(restaurantId: string, menuItemId: string, itemCode: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const item = await prisma.menuItem.findFirst({ where: { id: menuItemId, branch: { restaurantId } }, select: { id: true } });
  if (!item) return { ok: false, error: 'Menu item not found' };
  if (!itemCode) {
    await prisma.novaryqItemLink.deleteMany({ where: { restaurantId, menuItemId } });
    return { ok: true };
  }
  const code = itemCode.trim();
  if (!code || code.length > 64) return { ok: false, error: 'Enter a Novaryq item code (max 64 characters).' };
  await prisma.novaryqItemLink.upsert({
    where: { menuItemId },
    create: { restaurantId, menuItemId, novaryqItemCode: code },
    update: { novaryqItemCode: code },
  });
  return { ok: true };
}

/** Exact (normalized) name matches between unlinked Flavrly items and codes not yet used in this branch; ambiguous names are skipped. */
export function suggestMatches(
  flavrly: Array<{ id: string; name: string; linkedCode: string | null }>,
  novaryq: NovaryqMenuItem[],
  linkedCodes: Set<string>,
): Array<{ menuItemId: string; itemCode: string }> {
  const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>());
  const free = flavrly.filter((f) => !f.linkedCode);
  const fCount = count(free, (f) => normalizeName(f.name));
  const open = novaryq.filter((n) => !linkedCodes.has(n.itemCode));
  const nCount = count(open, (n) => normalizeName(n.name));
  const byName = new Map(open.map((n) => [normalizeName(n.name), n.itemCode]));
  const out: Array<{ menuItemId: string; itemCode: string }> = [];
  for (const f of free) {
    const k = normalizeName(f.name);
    if (k && fCount.get(k) === 1 && nCount.get(k) === 1) out.push({ menuItemId: f.id, itemCode: byName.get(k)! });
  }
  return out;
}

/** Flavrly items of a linked branch, their links, the live Novaryq menu and auto-match suggestions. */
export async function itemMappingView(restaurantId: string, branchId: string) {
  const loc = await requireLocation(restaurantId, branchId);
  const cfg = await requireConfig(restaurantId);
  const [items, links, menu] = await Promise.all([
    prisma.menuItem.findMany({
      where: { branchId, branch: { restaurantId } },
      select: { id: true, name: true, price: true, isAvailable: true, category: { select: { name: true } }, novaryqLink: { select: { novaryqItemCode: true, lastSyncedAt: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.novaryqItemLink.findMany({ where: { restaurantId, menuItem: { branchId } }, select: { novaryqItemCode: true } }),
    fetchNovaryqMenu(cfg, loc.novaryqLocationId),
  ]);
  const rows = items.map((i) => ({
    id: i.id, name: i.name, category: i.category.name, price: Number(i.price), isAvailable: i.isAvailable,
    linkedCode: i.novaryqLink?.novaryqItemCode ?? null, lastSyncedAt: i.novaryqLink?.lastSyncedAt ?? null,
  }));
  const suggestions = suggestMatches(rows, menu.items, new Set(links.map((l) => l.novaryqItemCode)));
  return { items: rows, novaryqItems: menu.items, suggestions };
}

export async function applyAutoMatch(restaurantId: string, branchId: string): Promise<{ linked: number }> {
  const view = await itemMappingView(restaurantId, branchId);
  let linked = 0;
  for (const s of view.suggestions) if ((await linkItem(restaurantId, s.menuItemId, s.itemCode)).ok) linked++;
  return { linked };
}

const nameKey = (s: string) => s.trim().toLowerCase();

/**
 * Brings an imported item's modifier groups in line with Novaryq (QA-D2). Groups and options
 * are matched by name (like items), so a re-import updates rows in place and their ids stay
 * stable (carts hold option ids). Inside a Novaryq group Novaryq is the master: options it no
 * longer has are removed. Groups Novaryq does not send are left alone — they are Flavrly-only
 * add-ons, which stay editable under "POS: Novaryq" (menu-master.ts). A group renamed in
 * Novaryq therefore arrives as a new group; the old one stays until removed on Flavrly.
 */
async function syncModifierGroups(tx: Prisma.TransactionClient, menuItemId: string, groups: NovaryqModifierGroup[]) {
  const existing = await tx.modifierGroup.findMany({
    where: { menuItemId },
    select: { id: true, name: true, options: { select: { id: true, name: true } } },
  });
  const used = new Set<string>();
  for (const [gi, g] of groups.entries()) {
    const groupData = { name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, required: g.required, sortOrder: gi };
    let group = existing.find((e) => !used.has(e.id) && nameKey(e.name) === nameKey(g.name));
    if (group) await tx.modifierGroup.update({ where: { id: group.id }, data: groupData });
    else group = { ...(await tx.modifierGroup.create({ data: { menuItemId, ...groupData } })), options: [] };
    used.add(group.id);
    const kept = new Set<string>();
    for (const [oi, o] of g.options.entries()) {
      const optionData = { name: o.name, priceDelta: o.price.toFixed(2), isAvailable: o.available, isDefault: o.isDefault, sortOrder: oi };
      const opt = group.options.find((e) => !kept.has(e.id) && nameKey(e.name) === nameKey(o.name));
      if (opt) {
        await tx.modifierOption.update({ where: { id: opt.id }, data: optionData });
        kept.add(opt.id);
      } else {
        kept.add((await tx.modifierOption.create({ data: { modifierGroupId: group.id, ...optionData } })).id);
      }
    }
    const gone = group.options.filter((e) => !kept.has(e.id)).map((e) => e.id);
    if (gone.length) await tx.modifierOption.deleteMany({ where: { id: { in: gone } } });
  }
  return groups.length;
}

/** Imports the location's Novaryq menu into the branch (create/update categories + items + modifier groups) and links every item. */
export async function importNovaryqMenu(restaurantId: string, branchId: string) {
  const loc = await requireLocation(restaurantId, branchId);
  const cfg = await requireConfig(restaurantId);
  const menu = await fetchNovaryqMenu(cfg, loc.novaryqLocationId);
  const priced = menu.items.filter((i) => i.price !== null && i.price >= 0);
  const rows: MenuRow[] = priced.map((i) => ({
    category: i.categoryName || 'Novaryq menu',
    name: i.name,
    price: i.price!,
    isAvailable: i.available,
  }));
  const summary = rows.length ? await applyMenuImport(branchId, rows) : { created: 0, updated: 0, skipped: 0, categoriesCreated: 0 };

  const branchItems = await prisma.menuItem.findMany({ where: { branchId }, select: { id: true, name: true, category: { select: { name: true } } } });
  const byKey = new Map(branchItems.map((b) => [`${b.category.name.toLowerCase()}::${b.name.toLowerCase()}`, b.id]));
  let linked = 0;
  let modifierGroups = 0;
  for (const i of priced) {
    const menuItemId = byKey.get(`${(i.categoryName || 'Novaryq menu').toLowerCase()}::${i.name.toLowerCase()}`);
    if (!menuItemId || !(await linkItem(restaurantId, menuItemId, i.itemCode)).ok) continue;
    linked++;
    modifierGroups += await prisma.$transaction((tx) => syncModifierGroups(tx, menuItemId, i.modifierGroups));
  }
  await prisma.novaryqItemLink.updateMany({ where: { restaurantId, menuItem: { branchId } }, data: { lastSyncedAt: new Date() } });
  return { ...summary, linked, modifierGroups, skippedUnpriced: menu.items.length - priced.length };
}

// ── Reconcile (fallback for missed webhooks) ─────────────────────────────────

export async function reconcileRestaurant(restaurantId: string): Promise<{ checked: number; changed: number; missing: number }> {
  const cfg = await loadNovaryqConfig(restaurantId);
  const out = { checked: 0, changed: 0, missing: 0 };
  if (!cfg?.enabled) return out;
  const locations = await prisma.novaryqLocationLink.findMany({ where: { restaurantId } });
  for (const loc of locations) {
    const fetchedAt = new Date();
    const menu = await fetchNovaryqMenu(cfg, loc.novaryqLocationId);
    const avail = new Map(menu.items.map((i) => [i.itemCode, i.available]));
    const links = await prisma.novaryqItemLink.findMany({
      where: { restaurantId, menuItem: { branchId: loc.branchId } },
      select: { id: true, menuItemId: true, novaryqItemCode: true, menuItem: { select: { isAvailable: true } } },
    });
    for (const l of links) {
      out.checked++;
      const a = avail.get(l.novaryqItemCode);
      if (a === undefined) { out.missing++; continue; }
      // A webhook applied after our snapshot wins: only rows not synced since fetchedAt are touched.
      const guard = await prisma.novaryqItemLink.updateMany({
        where: { id: l.id, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: fetchedAt } }] },
        data: { lastSyncedAt: fetchedAt },
      });
      if (guard.count === 1 && a !== l.menuItem.isAvailable) {
        await prisma.menuItem.update({ where: { id: l.menuItemId }, data: { isAvailable: a } });
        out.changed++;
      }
    }
  }
  return out;
}

export async function runNovaryqReconcile(): Promise<{ restaurants: number; changed: number; errors: number }> {
  const out = { restaurants: 0, changed: 0, errors: 0 };
  if (!novaryqFlagOn()) return out;
  const rows = await prisma.novaryqLocationLink.findMany({ distinct: ['restaurantId'], select: { restaurantId: true } });
  for (const { restaurantId } of rows) {
    try {
      const r = await reconcileRestaurant(restaurantId);
      out.restaurants++;
      out.changed += r.changed;
      if (r.missing) log.warn({ restaurantId, missing: r.missing }, 'novaryq.reconcile.codes_missing_in_pos');
    } catch (e) {
      out.errors++;
      log.error({ restaurantId, err: (e as Error).message }, 'novaryq.reconcile.failed');
    }
  }
  return out;
}
