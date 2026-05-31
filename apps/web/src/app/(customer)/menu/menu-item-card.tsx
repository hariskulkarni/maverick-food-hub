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

  // App-style menu card (the canonical Indian food-app pattern):
  //   • LEFT: text content — veg dot, name, price, description, prep time.
  //   • RIGHT: a square image with the ADD button hanging halfway off the
  //     bottom edge as a white "sticker" with a primary-coloured border
  //     and bold uppercase text. Heart sits top-right of the image.
  //
  // Phone: 116-px image column + ~80-px sticker button positioned absolutely.
  // md+: 144-px image column for a more generous desktop visual.
  //
  // The card has bottom padding reserved to clear the hanging button.
  const Heart = (
    <HeartButton
      menuItemId={item.id}
      initial={Boolean(item.isAuthed && item.isFavorited)}
      requireAuth={!item.isAuthed}
      variant="glass"
      size="sm"
    />
  );

  // The "sticker" Add control — white background, primary border, uppercase
  // primary text, slight shadow. Positioned absolutely so it hangs over the
  // bottom edge of the image. We render the three states (Add / Customize /
  // Stepper) at the same place so positioning is consistent.
  const StickerButton = customizable ? (
    <Button
      size="sm"
      variant="outline"
      className="tap-press h-9 w-[88%] md:w-[80%] rounded-lg bg-background border-2 border-primary text-primary font-bold uppercase tracking-wider text-[11px] md:text-xs px-2 shadow-md hover:bg-primary/5"
      onClick={() => setCustomizeOpen(true)}
    >
      <Plus className="size-3.5 mr-0.5" /> Add
      {qty > 0 && (
        <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground normal-case">
          {qty}
        </span>
      )}
    </Button>
  ) : !simpleLine ? (
    <Button
      size="sm"
      variant="outline"
      className="tap-press h-9 w-[88%] md:w-[80%] rounded-lg bg-background border-2 border-primary text-primary font-bold uppercase tracking-wider text-[11px] md:text-xs px-2 shadow-md hover:bg-primary/5"
      onClick={() => add({ id: item.id, refId: item.id, kind: 'item', branchId, name: item.name, unitPrice: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg })}
    >
      <Plus className="size-3.5 mr-0.5" /> Add
    </Button>
  ) : (
    <div className="flex h-9 w-[88%] md:w-[80%] items-center justify-between rounded-lg border-2 border-primary bg-background overflow-hidden shadow-md">
      <button
        className="h-full w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
        onClick={() => (simpleLine.quantity <= 1 ? remove(simpleLine.id) : setQty(simpleLine.id, simpleLine.quantity - 1))}
        aria-label="Decrease quantity"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="text-xs font-bold text-primary font-tabular-nums">{simpleLine.quantity}</span>
      <button
        className="h-full w-9 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
        onClick={() => setQty(simpleLine.id, simpleLine.quantity + 1)}
        aria-label="Increase quantity"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );

  // "Customizable" hint below the sticker button when there are variants
  // or modifier groups — matches the standard food-app affordance.
  const CustomizableHint = customizable ? (
    <div className="text-center text-[9px] md:text-[10px] text-muted-foreground italic mt-0.5 leading-tight">
      Customisable
    </div>
  ) : null;

  return (
    <div className="group relative flex w-full max-w-full flex-col rounded-2xl border bg-card card-lift overflow-hidden">
      {/* Card body. Reserved bottom-padding equals the hanging button height
          (h-9 = 36 px) split + the hint text height (~12 px), so the
          sticker button doesn't get clipped by the card edge. */}
      <div className="flex gap-3 md:gap-4 p-3 md:p-4 pb-7 md:pb-8 relative">
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-primary/[0.03] via-transparent to-transparent" />

        {/* LEFT — text content. min-w-0 keeps long titles from pushing
            the right image column off-screen. */}
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

        {/* RIGHT — square image with the sticker Add button hanging over
            the bottom edge. The column is shrink-0 with an explicit width
            so the left text can't push it off-screen. */}
        <div className="relative w-[116px] md:w-[144px] shrink-0">
          {/* Square image */}
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted shadow-sm">
            <Image
              src={item.imageUrl || imageFor(undefined)}
              alt={item.name}
              fill
              sizes="(max-width: 768px) 116px, 144px"
              className="object-cover transition-transform duration-500 group-hover:scale-110"
            />
            <div className="absolute top-1.5 right-1.5">{Heart}</div>
          </div>

          {/* Sticker button — absolute, centered horizontally, hanging
              ~half over the image's bottom edge for the floating effect. */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-4 flex flex-col items-center w-full">
            {StickerButton}
            {CustomizableHint}
          </div>
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
