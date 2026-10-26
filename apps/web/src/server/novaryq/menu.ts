/**
 * Novaryq menu sync (CONTRACT §5 "Menu"): connection test, location currency
 * check, menu import (reuses the spreadsheet importer), item linking + name
 * auto-match, availability (86 / un-86) and the periodic reconcile fallback.
 */
import { prisma } from '../db';
import { log } from '../log';
import { applyMenuImport, type MenuRow } from '../menu-io';
import { NovaryqApiError, novaryqRequest, type NovaryqCredentials } from './client';
import { loadNovaryqConfig, novaryqFlagOn } from './config';

export interface NovaryqMenuItem {
  itemCode: string;
  name: string;
  price: number | null;
  currency: string | null;
  available: boolean;
  categoryName: string | null;
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

/** Imports the location's Novaryq menu into the branch (create/update categories + items) and links every item. */
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
  for (const i of priced) {
    const menuItemId = byKey.get(`${(i.categoryName || 'Novaryq menu').toLowerCase()}::${i.name.toLowerCase()}`);
    if (menuItemId && (await linkItem(restaurantId, menuItemId, i.itemCode)).ok) linked++;
  }
  await prisma.novaryqItemLink.updateMany({ where: { restaurantId, menuItem: { branchId } }, data: { lastSyncedAt: new Date() } });
  return { ...summary, linked, skippedUnpriced: menu.items.length - priced.length };
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
