'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface CartLine {
  id: string;          // menuItemId or 'combo:'+comboId
  name: string;
  unitPrice: number;
  quantity: number;
  imageUrl?: string | null;
  isVeg?: boolean;
  notes?: string;
  kind: 'item' | 'combo';
  refId: string;       // menuItemId | comboId
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
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === line.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { ...line, quantity: qty }];
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
