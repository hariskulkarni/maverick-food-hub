/**
 * What the kitchen must see for one order line (P1-10): the chosen variant,
 * the modifier summary and the customer's line note. Shared by the kitchen
 * board, the printed KOT, the admin board/detail and the invoice so no surface
 * silently drops "Full, Extra cheese, no onion".
 */
export interface KotItemLike {
  name: string;
  selectedVariantName?: string | null;
  modifiersSummary?: string | null;
  notes?: string | null;
}

/** "Full · Extra cheese, No onion", or null when the line has no options. */
export function itemOptions(i: KotItemLike): string | null {
  const parts = [i.selectedVariantName, i.modifiersSummary].map((p) => p?.trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Name with options in brackets, for one-line summaries: "Biryani (Full · Extra raita)". */
export function itemLabel(i: KotItemLike): string {
  const opts = itemOptions(i);
  return opts ? `${i.name} (${opts})` : i.name;
}

export const FULFILLMENT_LABEL: Record<string, string> = {
  DELIVERY: 'Delivery',
  PICKUP: 'Pickup',
  DINE_IN: 'Dine-in',
};
