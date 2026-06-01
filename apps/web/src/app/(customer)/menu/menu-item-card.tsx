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

  // Tight, bulletproof layout — right column is 80 px on phones (was
  // 116, 96, 72 — none small enough). Image is 80x80 with the Heart
  // on top, and a small "+ Add" button directly below the image at
  // the same 80-px width. No hanging, no overlap, no surprises.
  // md+ scales up to 112-px for a more generous desktop visual.
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
      {/*
        Phone (< md): VERTICAL stack — image banner h-32 on top, content
        + Add button below. There ARE no horizontal columns, so geometry
        cannot clip horizontally. Uses only standard Tailwind utilities.
        md+: classic horizontal layout (flex with explicit widths).
      */}
      {/* ───────── PHONE: vertical stack ───────── */}
      <div className="md:hidden">
        {/* Compact 128-px image banner; full card width by definition. */}
        <div className="relative w-full h-32 bg-muted">
          <Image
            src={item.imageUrl || imageFor(undefined)}
            alt={item.name}
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute top-2 right-2">
            <HeartButton
              menuItemId={item.id}
              initial={Boolean(item.isAuthed && item.isFavorited)}
              requireAuth={!item.isAuthed}
              variant="glass"
              size="sm"
            />
          </div>
        </div>
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-[1.5px] ${item.isVeg ? 'border-success' : 'border-destructive'}`}
              title={item.isVeg ? 'Veg' : 'Non-veg'}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${item.isVeg ? 'bg-success' : 'bg-destructive'}`} />
            </span>
            <h3 className="font-semibold truncate">{item.name}</h3>
            {item.spicyLevel >= 2 && (
              <span className="inline-flex items-center text-destructive shrink-0" title={`Spicy ${item.spicyLevel}/3`}>
                <Flame className="size-3.5" />
                {item.spicyLevel >= 3 && <Flame className="size-3.5 -ml-1" />}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
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
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 break-words max-w-full overflow-hidden">
              {item.description}
            </p>
          )}
          <div className="pt-1">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" /> ~{item.prepTimeMin} min
            </span>
          </div>
          {/* Add button gets its OWN full-width row below everything else.
              On its own line it cannot be pushed off-screen by long titles
              or descriptions on the rows above. w-full + max-w-full keep
              it bounded to the card. */}
          <div className="pt-2">
            {customizable ? (
              <Button
                size="sm"
                variant="outline"
                className="tap-press h-10 w-full max-w-full rounded-lg border-2 border-primary bg-background text-primary font-bold uppercase tracking-wider text-sm shadow-sm hover:bg-primary/5"
                onClick={() => setCustomizeOpen(true)}
              >
                <Plus className="size-4 mr-1" /> Add
                {qty > 0 && (
                  <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground normal-case">
                    {qty}
                  </span>
                )}
              </Button>
            ) : !simpleLine ? (
              <Button
                size="sm"
                variant="outline"
                className="tap-press h-10 w-full max-w-full rounded-lg border-2 border-primary bg-background text-primary font-bold uppercase tracking-wider text-sm shadow-sm hover:bg-primary/5"
                onClick={() => add({ id: item.id, refId: item.id, kind: 'item', branchId, name: item.name, unitPrice: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg })}
              >
                <Plus className="size-4 mr-1" /> Add
              </Button>
            ) : (
              <div className="flex h-10 w-full items-center justify-between rounded-lg border-2 border-primary bg-background overflow-hidden shadow-sm">
                <button
                  className="h-full w-12 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                  onClick={() => (simpleLine.quantity <= 1 ? remove(simpleLine.id) : setQty(simpleLine.id, simpleLine.quantity - 1))}
                  aria-label="Decrease quantity"
                >
                  <Minus className="size-4" />
                </button>
                <span className="text-base font-bold text-primary font-tabular-nums">{simpleLine.quantity}</span>
                <button
                  className="h-full w-12 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                  onClick={() => setQty(simpleLine.id, simpleLine.quantity + 1)}
                  aria-label="Increase quantity"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ───────── DESKTOP (md+): horizontal row ───────── */}
      <div className="hidden md:flex gap-4 p-4 relative">
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-primary/[0.03] via-transparent to-transparent" />

        {/* LEFT — text. min-w-0 + overflow-hidden so the description
            can never extend past the column. */}
        <div className="relative flex-1 min-w-0 overflow-hidden">
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
          {item.description && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2 break-words max-w-full">
              {item.description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Clock className="size-3" /> ~{item.prepTimeMin} min</span>
          </div>
        </div>

        {/* RIGHT — image (112×112) + button. Fixed pixel width, shrink-0,
            cannot be pushed off-screen by left content. */}
        <div className="flex w-28 shrink-0 flex-col items-stretch gap-2.5">
          {/* 112×112 image (md+ only) */}
          <div className="relative h-28 w-28 overflow-hidden rounded-xl bg-muted shadow-sm">
            <Image
              src={item.imageUrl || imageFor(undefined)}
              alt={item.name}
              fill
              sizes="112px"
              className="object-cover transition-transform duration-500 group-hover:scale-110"
            />
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

          {/* Button — exactly w-full of the 80/112-px column. The "+ Add"
              text uses text-[11px] on phones so it never overflows. */}
          {customizable ? (
            <Button
              size="sm"
              variant="outline"
              className="tap-press h-8 md:h-9 w-full rounded-lg border-2 border-primary bg-background text-primary font-bold uppercase tracking-wider text-[11px] md:text-xs px-1 shadow-sm hover:bg-primary/5"
              onClick={() => setCustomizeOpen(true)}
            >
              <Plus className="size-3 mr-0.5" /> Add
              {qty > 0 && (
                <span className="ml-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground normal-case">
                  {qty}
                </span>
              )}
            </Button>
          ) : !simpleLine ? (
            <Button
              size="sm"
              variant="outline"
              className="tap-press h-8 md:h-9 w-full rounded-lg border-2 border-primary bg-background text-primary font-bold uppercase tracking-wider text-[11px] md:text-xs px-1 shadow-sm hover:bg-primary/5"
              onClick={() => add({ id: item.id, refId: item.id, kind: 'item', branchId, name: item.name, unitPrice: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg })}
            >
              <Plus className="size-3 mr-0.5" /> Add
            </Button>
          ) : (
            <div className="flex h-8 md:h-9 w-full items-center justify-between rounded-lg border-2 border-primary bg-background overflow-hidden shadow-sm">
              <button
                className="h-full w-7 md:w-8 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                onClick={() => (simpleLine.quantity <= 1 ? remove(simpleLine.id) : setQty(simpleLine.id, simpleLine.quantity - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="size-3" />
              </button>
              <span className="text-xs font-bold text-primary font-tabular-nums">{simpleLine.quantity}</span>
              <button
                className="h-full w-7 md:w-8 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                onClick={() => setQty(simpleLine.id, simpleLine.quantity + 1)}
                aria-label="Increase quantity"
              >
                <Plus className="size-3" />
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
