'use client';
/**
 * KotLine — one line on a kitchen ticket.
 *
 * Renders a single OrderItem with optional combo breakdown. Plain menu items
 * stay as a single row ("2× Veg Biryani"). Combo lines render the combo name
 * in bold and a nested list of the constituent menu items so the cook knows
 * what's actually being plated:
 *
 *   1× Family Combo
 *     ↳ Margherita Pizza ×1
 *     ↳ Coke ×2
 *
 * The breakdown is pre-computed server-side in /kitchen/page.tsx — we don't
 * fetch combo definitions client-side.
 */
import { Package } from 'lucide-react';

export interface ComboBreakdownEntry {
  name: string;
  qty: number;
}

export interface KotLineProps {
  name: string;
  quantity: number;
  comboBreakdown?: ComboBreakdownEntry[] | null;
}

export function KotLine({ name, quantity, comboBreakdown }: KotLineProps) {
  if (comboBreakdown && comboBreakdown.length > 0) {
    return (
      <li className="flex flex-col gap-0.5">
        <span className="font-semibold flex items-center gap-1">
          <Package className="size-3.5 text-primary" aria-hidden />
          <span className="mr-1">{quantity}×</span>{name}
        </span>
        <ul className="ml-5 mt-0.5 text-xs text-muted-foreground space-y-0.5">
          {comboBreakdown.map((e, i) => (
            <li key={`${e.name}-${i}`} className="flex items-center gap-1">
              <span aria-hidden>↳</span>
              <span>{e.name} ×{e.qty * quantity}</span>
            </li>
          ))}
        </ul>
      </li>
    );
  }
  return (
    <li className="flex justify-between gap-2">
      <span><span className="font-semibold mr-1">{quantity}×</span>{name}</span>
    </li>
  );
}
