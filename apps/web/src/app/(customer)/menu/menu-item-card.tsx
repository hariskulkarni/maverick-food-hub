'use client';
import Image from 'next/image';
import { Plus, Minus, Flame, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeartButton } from '@/components/heart-button';
import { money } from '@/lib/utils';
import { imageFor } from '@/lib/food-images';
import { useCart } from '../cart-context';
import { CrossSellStrip } from './cross-sell-strip';

export interface MenuItemForCard {
  id: string;
  name: string;
  description?: string | null;
  /** Happy-hour-adjusted price the cart will see. Always render in primary colour. */
  price: string | number;
  /** Original (pre-happy-hour) unit price — when truthy, render strike-through alongside `price`. */
  originalPrice?: string | number | null;
  /** Compact label for the chip beside the price ("Happy Hour · 20% off"). */
  happyHourLabel?: string | null;
  isVeg: boolean;
  spicyLevel: number;
  imageUrl?: string | null;
  prepTimeMin: number;
  /** When provided, render the favorite heart. False values render the button in auth-gate mode. */
  isAuthed?: boolean;
  isFavorited?: boolean;
}

export function MenuItemCard({ item }: { item: MenuItemForCard }) {
  const { lines, add, setQty, remove } = useCart();
  const inCart = lines.find((l) => l.refId === item.id && l.kind === 'item');
  const qty = inCart?.quantity ?? 0;

  return (
    <div className="group relative flex flex-col gap-0 rounded-2xl border bg-card card-lift overflow-hidden">
      <div className="flex gap-4 p-4 relative">
      {/* Hover tint */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-primary/[0.03] via-transparent to-transparent" />

      <div className="relative flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-[1.5px] ${item.isVeg ? 'border-success' : 'border-destructive'}`}
            title={item.isVeg ? 'Veg' : 'Non-veg'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${item.isVeg ? 'bg-success' : 'bg-destructive'}`} />
          </span>
          <h3 className="font-semibold truncate group-hover:text-primary transition-colors">{item.name}</h3>
          {item.spicyLevel >= 2 && (
            <span className="inline-flex items-center text-destructive" title={`Spicy ${item.spicyLevel}/3`}>
              <Flame className="size-3.5" />
              {item.spicyLevel >= 3 && <Flame className="size-3.5 -ml-1" />}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
          <span className={`text-base font-semibold ${item.originalPrice ? 'text-primary' : 'text-foreground'}`}>{money(item.price)}</span>
          {item.originalPrice && (
            <>
              <span className="text-xs text-muted-foreground line-through">{money(item.originalPrice)}</span>
              <span className="inline-flex items-center rounded-full bg-warning/10 text-warning border border-warning/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
                {item.happyHourLabel ?? 'Happy Hour'}
              </span>
            </>
          )}
        </div>
        {item.description && <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{item.description}</p>}
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Clock className="size-3" /> ~{item.prepTimeMin} min</span>
        </div>
      </div>

      <div className="relative flex shrink-0 flex-col items-end justify-between gap-3">
        <div className="relative h-24 w-24 overflow-hidden rounded-xl bg-muted shadow-sm">
          <Image
            src={item.imageUrl || imageFor(undefined)}
            alt={item.name}
            fill
            sizes="96px"
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="absolute top-1 right-1">
            <HeartButton
              menuItemId={item.id}
              initial={Boolean(item.isAuthed && item.isFavorited)}
              requireAuth={!item.isAuthed}
              variant="glass"
              size="sm"
            />
          </div>
        </div>

        {qty === 0 ? (
          // 44×44 minimum tap target on mobile (sm: keeps original height).
          <Button
            size="sm"
            variant="outline"
            className="tap-press shadow-sm hover:border-primary hover:text-primary h-11 min-w-[44px] px-4 md:h-9 md:px-3"
            onClick={() => add({ id: item.id, refId: item.id, kind: 'item', name: item.name, unitPrice: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg })}
          >
            <Plus className="size-4" /> Add
          </Button>
        ) : (
          // Stepper: each ± hit area is 44×44 on mobile.
          <div className="flex items-center rounded-full border-2 border-primary bg-background overflow-hidden shadow-sm tap-press">
            <button
              className="h-11 w-11 md:h-9 md:w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
              onClick={() => (qty <= 1 ? remove(item.id) : setQty(item.id, qty - 1))}
              aria-label="Decrease quantity"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-7 text-center text-sm font-bold text-primary font-tabular-nums">{qty}</span>
            <button
              className="h-11 w-11 md:h-9 md:w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
              onClick={() => setQty(item.id, qty + 1)}
              aria-label="Increase quantity"
            >
              <Plus className="size-4" />
            </button>
          </div>
        )}
      </div>
      </div>
      {/* Cross-sells — only mount once the item is in the cart, so we don't
          fire an API call for every visible menu card. The strip is null-safe
          and silently hides when no suggestions are configured. */}
      {qty > 0 && (
        <div className="px-4 pb-3 -mt-1">
          <CrossSellStrip surface="pdp" parentItemId={item.id} />
        </div>
      )}
    </div>
  );
}
