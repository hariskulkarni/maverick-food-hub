/**
 * "POS: Novaryq" — Novaryq is the menu master (ADR-FNI-001 §2, §4.2).
 *
 * For a restaurant that switched it on, the name, price and availability of every
 * Flavrly item LINKED to a Novaryq item come from Novaryq (import, 86 webhooks,
 * reconcile) and are read-only on Flavrly. Unlinked (Flavrly-only) items, photos,
 * descriptions, variants and add-ons stay editable. A channel-only price on Flavrly
 * is an explicit opt-in (allowPriceOverride). Bulk spreadsheet/template imports are
 * refused because they rewrite items by name; "Import Novaryq menu" is the way in.
 */
import { prisma } from '../db';
import { loadNovaryqConfig, novaryqFlagOn } from './config';

export interface MenuMasterState { on: boolean; allowPriceOverride: boolean; manageUrl: string | null }

export async function menuMasterState(restaurantId: string): Promise<MenuMasterState> {
  if (!novaryqFlagOn()) return { on: false, allowPriceOverride: false, manageUrl: null };
  const cfg = await loadNovaryqConfig(restaurantId);
  if (!cfg?.enabled || !cfg.menuMaster) return { on: false, allowPriceOverride: false, manageUrl: null };
  return { on: true, allowPriceOverride: cfg.allowPriceOverride, manageUrl: cfg.baseUrl };
}

const managed = (fields: string[], manageUrl: string | null, error: string) =>
  Response.json({ error, code: 'novaryq/managed', fields, manageUrl }, { status: 409 });

/** 409 when the patch would CHANGE a Novaryq-owned field of a linked item; null otherwise. */
export async function novaryqItemLock(
  restaurantId: string,
  itemIds: string[],
  patch: { name?: string; price?: number; isAvailable?: boolean },
): Promise<Response | null> {
  const st = await menuMasterState(restaurantId);
  if (!st.on) return null;
  const links = await prisma.novaryqItemLink.findMany({
    where: { restaurantId, menuItemId: { in: itemIds } },
    select: { menuItemId: true, menuItem: { select: { name: true, price: true, isAvailable: true } } },
  });
  const fields = new Set<string>();
  for (const { menuItem: m } of links) {
    if (patch.name !== undefined && patch.name !== m.name) fields.add('name');
    if (patch.price !== undefined && !st.allowPriceOverride && Number(patch.price) !== Number(m.price)) fields.add('price');
    if (patch.isAvailable !== undefined && patch.isAvailable !== m.isAvailable) fields.add('isAvailable');
  }
  if (fields.size === 0) return null;
  const list = [...fields];
  return managed(list, st.manageUrl, `Managed in Novaryq: change ${list.join(', ').replace('isAvailable', 'availability')} in your Novaryq POS — it syncs to Flavrly automatically.`);
}

/** 409 for spreadsheet / template imports while Novaryq is the menu master. */
export async function novaryqBulkImportLock(restaurantId: string): Promise<Response | null> {
  const st = await menuMasterState(restaurantId);
  if (!st.on) return null;
  return managed([], st.manageUrl, 'Your menu is managed in Novaryq. Use Admin → POS integration → Import Novaryq menu instead.');
}
