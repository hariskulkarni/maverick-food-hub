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

  return (
    // Card itself: w-full + max-w-full + overflow-hidden = it can never
    // exceed its parent's content box no matter what's inside.
    <div className="group relative flex w-full max-w-full flex-col gap-0 rounded-2xl border bg-card card-lift overflow-hidden">
      {/* Tighter padding on phones, shrink to gap-2 so a 64-px image + button
          column fit even on a 320-px viewport. md+ keeps the previous desktop
          breathing room. */}
      <div className="flex gap-2.5 md:gap-4 p-2.5 md:p-4 relative">
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

      {/* Right column: image + add control. Phone: 72-px image with the
          button directly below at the same width — guaranteed to fit even
          on a 320-px viewport. md+: original 96-px image. The whole column
          is shrink-0 with an explicit width so the left content can't push
          it past the card's right edge. */}
      <div className="relative flex w-[72px] md:w-24 shrink-0 flex-col items-end justify-between gap-2 md:gap-3">
        <div className="relative h-[72px] w-[72px] md:h-24 md:w-24 overflow-hidden rounded-xl bg-muted shadow-sm">
          <Image
            src={item.imageUrl || imageFor(undefined)}
            alt={item.name}
            fill
            sizes="(max-width: 768px) 72px, 96px"
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

        {customizable ? (
          // Customizable items always open the modal. On phones the button
          // is fixed to the same width as the image (72 px) so it can never
          // exceed the right column. md+ keeps the descriptive label.
          <Button
            size="sm"
            variant="outline"
            className="tap-press shadow-sm hover:border-primary hover:text-primary h-10 w-full px-0 md:h-9 md:w-auto md:px-3"
            onClick={() => setCustomizeOpen(true)}
          >
            <SlidersHorizontal className="size-4 md:mr-1" />
            <span className="hidden md:inline">{qty > 0 ? `Add more · ${qty}` : 'Customize'}</span>
            {qty > 0 && (
              <span className="md:hidden ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {qty}
              </span>
            )}
          </Button>
        ) : !simpleLine ? (
          // Simple add. Phone: w-full inside the 72px right column so the
          // button never exceeds the image column. md+: original sizing.
          <Button
            size="sm"
            variant="outline"
            className="tap-press shadow-sm hover:border-primary hover:text-primary h-10 w-full px-0 md:h-9 md:w-auto md:px-3"
            onClick={() => add({ id: item.id, refId: item.id, kind: 'item', branchId, name: item.name, unitPrice: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg })}
          >
            <Plus className="size-4 md:mr-1" /> <span className="text-sm font-semibold md:font-normal">Add</span>
          </Button>
        ) : (
          // Stepper: width-bounded to the 72-px image column on phones.
          // Phone tap target stays 40×40 (just above 40-min) so the whole
          // stepper fits — minus + qty + plus = 24+24+24 = ~72px.
          <div className="flex w-full items-center justify-between rounded-full border-2 border-primary bg-background overflow-hidden shadow-sm tap-press">
            <button
              className="h-10 w-10 md:h-9 md:w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
              onClick={() => (simpleLine.quantity <= 1 ? remove(simpleLine.id) : setQty(simpleLine.id, simpleLine.quantity - 1))}
              aria-label="Decrease quantity"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-sm font-bold text-primary font-tabular-nums">{simpleLine.quantity}</span>
            <button
              className="h-10 w-10 md:h-9 md:w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
              onClick={() => setQty(simpleLine.id, simpleLine.quantity + 1)}
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
