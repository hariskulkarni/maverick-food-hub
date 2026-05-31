'use client';
import Image from 'next/image';
import { useState } from 'react';
import { Plus, Minus, Flame, Clock, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HeartButton } from '@/components/heart-button';
import { money } from '@/lib/utils';
import { imageFor } from '@/lib/food-images';
import { useCart } from '../cart-context';
import { CrossSellStrip } from './cross-sell-strip';
import {
  ItemCustomizeModal,
  type ModalVariant,
  type ModalGroup,
  type AddToCartSelection
} from './item-customize-modal';

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
  /** Size options. When present, tapping "Add" opens the customize modal. */
  variants?: ModalVariant[];
  /** Add-on groups. When present (or variants present), tapping "Add" opens the customize modal. */
  modifierGroups?: ModalGroup[];
}

export function MenuItemCard({ item, branchId }: { item: MenuItemForCard; branchId: string }) {
  const { lines, add, setQty, remove } = useCart();
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // An item is "customizable" when it has size variants and/or add-on groups.
  // Those open the selection modal instead of one-tap add, since the same item
  // can produce several distinct cart lines.
  const hasVariants = (item.variants?.length ?? 0) > 0;
  const hasModifiers = (item.modifierGroups?.length ?? 0) > 0;
  const customizable = hasVariants || hasModifiers;

  // Sum across every cart line referencing this item (a customizable item may
  // span several lines). For the simple case this is just the single line's qty.
  const itemLines = lines.filter((l) => l.refId === item.id && l.kind === 'item');
  const qty = itemLines.reduce((s, l) => s + l.quantity, 0);
  // The plain stepper only manages a single, selection-free line.
  const simpleLine = customizable ? undefined : itemLines[0];

  function addSelection(sel: AddToCartSelection) {
    add(
      {
        id: item.id, // recomputed inside add() from the selection signature
        refId: item.id,
        kind: 'item',
        branchId,
        name: item.name,
        unitPrice: sel.unitPrice,
        imageUrl: item.imageUrl,
        isVeg: item.isVeg,
        selectedVariantId: sel.selectedVariantId,
        selectedModifierOptionIds: sel.selectedModifierOptionIds,
        variantName: sel.variantName,
        modifiersSummary: sel.modifiersSummary
      },
      sel.quantity
    );
    setCustomizeOpen(false);
  }

  // Restored horizontal layout per user request: text on the left, image
  // + Add button stacked on the right. On phones we use a smaller right
  // column (64 px) so both the image AND the Add button sit fully on
  // screen at 360-414 px viewports. On md+ we use the original 96 px.
  const Heart = (
    <HeartButton
      menuItemId={item.id}
      initial={Boolean(item.isAuthed && item.isFavorited)}
      requireAuth={!item.isAuthed}
      variant="glass"
      size="sm"
    />
  );

  return (
    <div className="group relative flex w-full max-w-full flex-col rounded-2xl border bg-card card-lift overflow-hidden">
      {/* Horizontal row across all breakpoints. Phone: tight padding (p-3),
          gap-3, 64-px right column. md+: original p-4 / gap-4 / 96-px. */}
      <div className="flex gap-3 md:gap-4 p-3 md:p-4 relative">
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-primary/[0.03] via-transparent to-transparent" />

        {/* LEFT — text content. min-w-0 lets the title truncate so it
            never pushes the right column off-screen. */}
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
              <span className="inline-flex items-center text-destructive shrink-0" title={`Spicy ${item.spicyLevel}/3`}>
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

        {/* RIGHT — image (square) on top, Add button bounded to the same
            column width below. Phone: 64 px column. md+: 96 px. The column
            is shrink-0 with an EXPLICIT width so the left text can't push
            it off-screen. Items-stretch lets the button fill the column. */}
        <div className="relative flex w-16 md:w-24 shrink-0 flex-col items-stretch justify-between gap-2 md:gap-3">
          <div className="relative h-16 w-16 md:h-24 md:w-24 overflow-hidden rounded-xl bg-muted shadow-sm">
            <Image
              src={item.imageUrl || imageFor(undefined)}
              alt={item.name}
              fill
              sizes="(max-width: 768px) 64px, 96px"
              className="object-cover transition-transform duration-500 group-hover:scale-110"
            />
            <div className="absolute top-1 right-1">{Heart}</div>
          </div>

          {customizable ? (
            <Button
              size="sm"
              variant="outline"
              className="tap-press shadow-sm hover:border-primary hover:text-primary h-9 w-full px-0 text-xs md:h-9 md:w-auto md:px-3 md:text-sm"
              onClick={() => setCustomizeOpen(true)}
            >
              <SlidersHorizontal className="size-3.5 md:size-4 md:mr-1" />
              <span className="hidden md:inline">{qty > 0 ? `Add more · ${qty}` : 'Customize'}</span>
              {qty > 0 && (
                <span className="md:hidden ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {qty}
                </span>
              )}
            </Button>
          ) : !simpleLine ? (
            <Button
              size="sm"
              variant="outline"
              className="tap-press shadow-sm hover:border-primary hover:text-primary h-9 w-full px-0 text-xs md:h-9 md:w-auto md:px-3 md:text-sm"
              onClick={() => add({ id: item.id, refId: item.id, kind: 'item', branchId, name: item.name, unitPrice: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg })}
            >
              <Plus className="size-3.5 md:size-4 md:mr-1" />
              <span className="ml-0.5 md:ml-0">Add</span>
            </Button>
          ) : (
            <div className="flex w-full items-center justify-between rounded-full border-2 border-primary bg-background overflow-hidden shadow-sm tap-press">
              <button
                className="h-9 w-9 md:h-9 md:w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                onClick={() => (simpleLine.quantity <= 1 ? remove(simpleLine.id) : setQty(simpleLine.id, simpleLine.quantity - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="text-xs md:text-sm font-bold text-primary font-tabular-nums">{simpleLine.quantity}</span>
              <button
                className="h-9 w-9 md:h-9 md:w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                onClick={() => setQty(simpleLine.id, simpleLine.quantity + 1)}
                aria-label="Increase quantity"
              >
                <Plus className="size-3.5" />
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
          <CrossSellStrip surface="pdp" parentItemId={item.id} branchId={branchId} />
        </div>
      )}

      {customizable && (
        <ItemCustomizeModal
          item={{
            id: item.id,
            name: item.name,
            price: Number(item.price),
            imageUrl: item.imageUrl,
            isVeg: item.isVeg,
            spicyLevel: item.spicyLevel,
            variants: item.variants,
            modifierGroups: item.modifierGroups
          }}
          open={customizeOpen}
          onClose={() => setCustomizeOpen(false)}
          onConfirm={addSelection}
        />
      )}
    </div>
  );
}
