'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface CartLine {
  id: string;          // line key — see lineKey(): includes the selection signature so
                       // the same menu item with different size/add-ons forms distinct lines.
  name: string;
  unitPrice: number;
  quantity: number;
  imageUrl?: string | null;
  isVeg?: boolean;
  notes?: string;
  kind: 'item' | 'combo';
  refId: string;       // menuItemId | comboId
  /** The branch this item belongs to. Lets the cart scope offers/coupons to the
   *  correct restaurant in the multi-tenant marketplace (instead of guessing the
   *  oldest active branch). All lines in a single cart share one branch. */
  branchId?: string | null;
  // ── Variant (size) + modifier (add-on) selections ──────────────────────────
  // The server re-prices authoritatively from the IDs below; `unitPrice`,
  // `variantName` and `modifiersSummary` are display-only snapshots.
  selectedVariantId?: string | null;
  selectedModifierOptionIds?: string[];
  /** Display label for the chosen size, e.g. "Full". Null when the item has no variants. */
  variantName?: string | null;
  /** Display label for the chosen add-ons, e.g. "Extra cheese, No onion". */
  modifiersSummary?: string | null;
}

/**
 * Stable, order-independent key for a cart line. Two lines merge only when they
 * reference the same item/combo AND carry an identical selection signature.
 * Modifier option ids are sorted so selection order never affects the key.
 */
export function lineKey(input: {
  kind: 'item' | 'combo';
  refId: string;
  selectedVariantId?: string | null;
  selectedModifierOptionIds?: string[];
}): string {
  const base = input.kind === 'combo' ? `combo:${input.refId}` : input.refId;
  const variant = input.selectedVariantId ?? '';
  const mods = [...(input.selectedModifierOptionIds ?? [])].sort().join(',');
  if (!variant && !mods) return base; // no selections → plain item key (legacy-compatible)
  return `${base}|v=${variant}|m=${mods}`;
}

interface CartCtx {
  lines: CartLine[];
  add: (line: Omit<CartLine, 'quantity'>, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  subtotal: number;
  count: number;
}

const Ctx = createContext<CartCtx | null>(null);

const KEY = 'restaurant.cart.v1';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {}
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines, hydrated]);

  const add: CartCtx['add'] = useCallback((line, qty = 1) => {
    // Always derive the line key from the selection signature so distinct
    // size/add-on combinations of the same item never collapse into one line.
    const id = lineKey(line);
    const normalized: Omit<CartLine, 'quantity'> = { ...line, id };
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { ...normalized, quantity: qty }];
    });
  }, []);
  const setQty: CartCtx['setQty'] = useCallback((id, qty) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, qty) } : l)));
  }, []);
  const remove: CartCtx['remove'] = useCallback((id) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }, []);
  const clear = useCallback(() => setLines([]), []);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0), [lines]);
  const count = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);

  return <Ctx.Provider value={{ lines, add, setQty, remove, clear, subtotal, count }}>{children}</Ctx.Provider>;
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart used outside CartProvider');
  return v;
}
