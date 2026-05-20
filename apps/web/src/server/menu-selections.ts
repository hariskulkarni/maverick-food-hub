/**
 * Pure variant + modifier selection resolution.
 *
 * Kept free of Prisma so it can be unit-tested in isolation and reused by both
 * the order path (server-authoritative pricing) and any preview/quote endpoint.
 *
 * Pricing model:
 *   - A MenuItem may have N *variants* (e.g. Half / Full). Exactly ONE variant
 *     applies to a line. Its `price` REPLACES the item's base price (it is an
 *     absolute price, not a delta). If the item has variants and the caller
 *     sends none, we fall back to the default variant (or the first), so a
 *     legacy client that doesn't know about variants still gets a valid price.
 *   - A MenuItem may have N *modifier groups* (e.g. "Add-ons", "Spice level").
 *     Each group has min/max selection bounds. Each chosen option carries a
 *     `priceDelta` that is ADDED to the (variant-or-base) line price.
 *
 * The function validates the selection against the item's real configuration
 * and throws a MenuSelectionError on any violation — never trust client prices.
 */

export class MenuSelectionError extends Error {}

export interface VariantLike {
  id: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface OptionLike {
  id: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
}

export interface GroupLike {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: OptionLike[];
}

export interface SelectionInput {
  selectedVariantId?: string | null;
  selectedModifierOptionIds?: string[] | null;
}

export interface ResolvedSelections {
  /** The applied variant, or null when the item has no variants. */
  variant: { id: string; name: string; price: number } | null;
  /** Chosen modifier options, in the item's group/option order. */
  modifiers: { id: string; name: string; priceDelta: number; groupName: string }[];
  /** Sum of all chosen option priceDeltas (added to the line price). */
  modifierDelta: number;
  /** Snapshot for OrderItem.selectedVariantName (null when no variants). */
  variantName: string | null;
  /** Snapshot for OrderItem.modifiersSummary (null when nothing chosen). */
  modifiersSummary: string | null;
}

/**
 * Resolve + validate the variant and modifier selection for a single line.
 * `itemName` is only used to build readable error messages.
 */
export function resolveLineSelections(
  itemName: string,
  variants: VariantLike[],
  groups: GroupLike[],
  input: SelectionInput
): ResolvedSelections {
  // ── Variant ────────────────────────────────────────────────────────────────
  let variant: { id: string; name: string; price: number } | null = null;
  if (variants.length > 0) {
    let chosen: VariantLike | undefined;
    if (input.selectedVariantId) {
      chosen = variants.find((v) => v.id === input.selectedVariantId);
      if (!chosen) {
        throw new MenuSelectionError(`Selected option is not valid for ${itemName}`);
      }
      if (!chosen.isAvailable) {
        throw new MenuSelectionError(`"${chosen.name}" is currently unavailable for ${itemName}`);
      }
    } else {
      // No explicit choice → fall back to the default (or first) AVAILABLE variant
      // so legacy clients still resolve to a real, sellable price.
      chosen =
        variants.find((v) => v.isDefault && v.isAvailable) ??
        variants.find((v) => v.isAvailable);
      if (!chosen) {
        throw new MenuSelectionError(`No available size/option for ${itemName}`);
      }
    }
    variant = { id: chosen.id, name: chosen.name, price: chosen.price };
  } else if (input.selectedVariantId) {
    // Caller sent a variant for an item that has none — reject rather than
    // silently ignore, since it signals a stale menu on the client.
    throw new MenuSelectionError(`${itemName} has no selectable options`);
  }

  // ── Modifiers ───────────────────────────────────────────────────────────────
  const selectedIds = new Set((input.selectedModifierOptionIds ?? []).filter(Boolean));
  // Build a lookup of every legitimate option id for this item so we can reject
  // ids that don't belong to any of the item's groups.
  const optionToGroup = new Map<string, { option: OptionLike; group: GroupLike }>();
  for (const g of groups) {
    for (const o of g.options) optionToGroup.set(o.id, { option: o, group: g });
  }
  for (const id of selectedIds) {
    if (!optionToGroup.has(id)) {
      throw new MenuSelectionError(`An add-on you selected is not valid for ${itemName}`);
    }
  }

  const modifiers: ResolvedSelections['modifiers'] = [];
  for (const g of groups) {
    const chosenInGroup = g.options.filter((o) => selectedIds.has(o.id));
    const count = chosenInGroup.length;
    const min = Math.max(g.minSelect, g.required ? Math.max(1, g.minSelect) : 0);
    if (count < min) {
      throw new MenuSelectionError(
        `"${g.name}" for ${itemName} requires at least ${min} selection${min === 1 ? '' : 's'}`
      );
    }
    if (g.maxSelect > 0 && count > g.maxSelect) {
      throw new MenuSelectionError(
        `"${g.name}" for ${itemName} allows at most ${g.maxSelect} selection${g.maxSelect === 1 ? '' : 's'}`
      );
    }
    for (const o of chosenInGroup) {
      if (!o.isAvailable) {
        throw new MenuSelectionError(`"${o.name}" is currently unavailable for ${itemName}`);
      }
      modifiers.push({ id: o.id, name: o.name, priceDelta: o.priceDelta, groupName: g.name });
    }
  }

  const modifierDelta = modifiers.reduce((s, m) => s + m.priceDelta, 0);
  const modifiersSummary =
    modifiers.length > 0 ? modifiers.map((m) => m.name).join(', ') : null;

  return {
    variant,
    modifiers,
    modifierDelta,
    variantName: variant ? variant.name : null,
    modifiersSummary
  };
}
