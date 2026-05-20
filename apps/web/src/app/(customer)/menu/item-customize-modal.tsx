'use client';

/**
 * Variant (size) + modifier (add-on) selection modal.
 *
 * Mirrors the bottom-sheet styling used elsewhere in the customer area (see
 * category-fab.tsx): full-screen backdrop, body-scroll lock, Escape to close,
 * a centred panel on desktop and a bottom sheet on mobile.
 *
 * Pricing is DISPLAY ONLY — the server (placeOrder / menu-selections.ts)
 * re-prices authoritatively from `selectedVariantId` + `selectedModifierOptionIds`.
 * We replicate the same math here purely so the customer sees a live total, and
 * we enforce the same min/max/required rules so the "Add" button is only
 * enabled for selections the server will accept.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Minus, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';

export interface ModalVariant {
  id: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface ModalOption {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface ModalGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ModalOption[];
}

export interface CustomizableItem {
  id: string;
  name: string;
  /** Base (happy-hour-adjusted) price, used as a fallback when there are no variants. */
  price: number;
  imageUrl?: string | null;
  isVeg: boolean;
  spicyLevel?: number;
  variants?: ModalVariant[];
  modifierGroups?: ModalGroup[];
}

export interface AddToCartSelection {
  selectedVariantId: string | null;
  selectedModifierOptionIds: string[];
  variantName: string | null;
  modifiersSummary: string | null;
  unitPrice: number;
  quantity: number;
}

/** Effective minimum selections for a group (a required group implies >= 1). */
function effectiveMin(g: ModalGroup): number {
  return Math.max(g.minSelect, g.required ? Math.max(1, g.minSelect) : 0);
}

export function ItemCustomizeModal({
  item,
  open,
  onClose,
  onConfirm
}: {
  item: CustomizableItem;
  open: boolean;
  onClose: () => void;
  onConfirm: (sel: AddToCartSelection) => void;
}) {
  const variants = useMemo(() => item.variants ?? [], [item.variants]);
  const groups = useMemo(() => item.modifierGroups ?? [], [item.modifierGroups]);

  // Pick a sensible default variant: the default-and-available one, else the
  // first available, matching the server's fallback logic.
  const defaultVariantId = useMemo(() => {
    if (variants.length === 0) return null;
    return (
      variants.find((v) => v.isDefault && v.isAvailable)?.id ??
      variants.find((v) => v.isAvailable)?.id ??
      null
    );
  }, [variants]);

  const [variantId, setVariantId] = useState<string | null>(defaultVariantId);
  const [optionIds, setOptionIds] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);

  // Re-seed selections whenever the modal (re)opens for an item: default
  // variant + any default available options that fit the group bounds.
  useEffect(() => {
    if (!open) return;
    setVariantId(defaultVariantId);
    setQty(1);
    const seeded = new Set<string>();
    for (const g of groups) {
      const defaults = g.options.filter((o) => o.isDefault && o.isAvailable);
      const cap = g.maxSelect > 0 ? g.maxSelect : defaults.length;
      defaults.slice(0, cap).forEach((o) => seeded.add(o.id));
    }
    setOptionIds(seeded);
  }, [open, defaultVariantId, groups]);

  // Body-scroll lock + Escape to dismiss while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const selectedVariant = variants.find((v) => v.id === variantId) ?? null;

  function toggleOption(g: ModalGroup, o: ModalOption) {
    if (!o.isAvailable) return;
    setOptionIds((prev) => {
      const next = new Set(prev);
      const single = g.maxSelect === 1;
      if (next.has(o.id)) {
        // Don't allow dropping below a required single's last selection by tap —
        // but a checkbox group can always uncheck (min is validated for "Add").
        next.delete(o.id);
        return next;
      }
      if (single) {
        // Radio behaviour: clear the rest of this group first.
        for (const opt of g.options) next.delete(opt.id);
      } else if (g.maxSelect > 0) {
        const chosenInGroup = g.options.filter((x) => next.has(x.id)).length;
        if (chosenInGroup >= g.maxSelect) return prev; // at cap → ignore
      }
      next.add(o.id);
      return next;
    });
  }

  // Ordered list of chosen modifiers (group/option order), used for pricing +
  // the human-readable summary, matching the server's ordering.
  const chosenModifiers = useMemo(() => {
    const out: ModalOption[] = [];
    for (const g of groups) {
      for (const o of g.options) if (optionIds.has(o.id)) out.push(o);
    }
    return out;
  }, [groups, optionIds]);

  const basePrice = selectedVariant ? selectedVariant.price : item.price;
  const modifierDelta = chosenModifiers.reduce((s, o) => s + o.priceDelta, 0);
  const unitPrice = basePrice + modifierDelta;

  // Validation: every group must satisfy its min/required bound; a chosen
  // variant (when the item has any) must be available.
  const requirementsMet = useMemo(() => {
    if (variants.length > 0 && (!selectedVariant || !selectedVariant.isAvailable)) return false;
    for (const g of groups) {
      const count = g.options.filter((o) => optionIds.has(o.id)).length;
      if (count < effectiveMin(g)) return false;
    }
    return true;
  }, [variants.length, selectedVariant, groups, optionIds]);

  if (!open) return null;

  function confirm() {
    if (!requirementsMet) return;
    onConfirm({
      selectedVariantId: selectedVariant ? selectedVariant.id : null,
      selectedModifierOptionIds: chosenModifiers.map((o) => o.id),
      variantName: selectedVariant ? selectedVariant.name : null,
      modifiersSummary: chosenModifiers.length > 0 ? chosenModifiers.map((o) => o.name).join(', ') : null,
      unitPrice,
      quantity: qty
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end md:items-center md:justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Customize ${item.name}`}
    >
      <div
        className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-background shadow-2xl animate-in slide-in-from-bottom duration-200 md:max-w-md md:rounded-2xl md:slide-in-from-bottom-0 md:zoom-in-95"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: 'calc(88vh - env(safe-area-inset-bottom, 0px))' }}
      >
        {/* Header */}
        <div className="px-4 pt-3 pb-3 border-b">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30 md:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-[1.5px] ${item.isVeg ? 'border-success' : 'border-destructive'}`}
                  title={item.isVeg ? 'Veg' : 'Non-veg'}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${item.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                </span>
                <h3 className="display text-lg font-semibold truncate">{item.name}</h3>
                {(item.spicyLevel ?? 0) >= 2 && (
                  <span className="inline-flex items-center text-destructive" title={`Spicy ${item.spicyLevel}/3`}>
                    <Flame className="size-3.5" />
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">Customize your order</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Scrollable options */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* Variants — single-choice radios */}
          {variants.length > 0 && (
            <fieldset>
              <legend className="flex items-center gap-2 text-sm font-semibold">
                Size
                <span className="rounded-full bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  Required
                </span>
              </legend>
              <div className="mt-2 space-y-1.5">
                {variants.map((v) => {
                  const checked = variantId === v.id;
                  return (
                    <label
                      key={v.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors ${
                        v.isAvailable ? 'cursor-pointer hover:bg-accent' : 'opacity-50 cursor-not-allowed'
                      } ${checked ? 'border-primary bg-primary/5' : 'border-border'}`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <span
                          className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${
                            checked ? 'border-primary' : 'border-muted-foreground/40'
                          }`}
                        >
                          {checked && <span className="size-2 rounded-full bg-primary" />}
                        </span>
                        <span className="truncate text-sm font-medium">{v.name}</span>
                        {!v.isAvailable && <span className="text-[11px] text-muted-foreground">Unavailable</span>}
                      </span>
                      <span className="shrink-0 text-sm font-semibold font-tabular-nums">{money(v.price)}</span>
                      <input
                        type="radio"
                        name="variant"
                        className="sr-only"
                        checked={checked}
                        disabled={!v.isAvailable}
                        onChange={() => v.isAvailable && setVariantId(v.id)}
                      />
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* Modifier groups */}
          {groups.map((g) => {
            const min = effectiveMin(g);
            const single = g.maxSelect === 1;
            const chosenInGroup = g.options.filter((o) => optionIds.has(o.id)).length;
            const atCap = g.maxSelect > 0 && chosenInGroup >= g.maxSelect;
            const hint =
              min > 0 && g.maxSelect === min
                ? `Choose ${min}`
                : min > 0
                  ? `Choose at least ${min}${g.maxSelect > 0 ? `, up to ${g.maxSelect}` : ''}`
                  : g.maxSelect > 0
                    ? `Optional · up to ${g.maxSelect}`
                    : 'Optional';
            return (
              <fieldset key={g.id}>
                <legend className="flex items-center gap-2 text-sm font-semibold">
                  {g.name}
                  {min > 0 ? (
                    <span className="rounded-full bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      Required
                    </span>
                  ) : null}
                </legend>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
                <div className="mt-2 space-y-1.5">
                  {g.options.map((o) => {
                    const checked = optionIds.has(o.id);
                    const disabled = !o.isAvailable || (!checked && !single && atCap);
                    return (
                      <label
                        key={o.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 transition-colors ${
                          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'
                        } ${checked ? 'border-primary bg-primary/5' : 'border-border'}`}
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          <span
                            className={`grid size-4 shrink-0 place-items-center border-2 ${single ? 'rounded-full' : 'rounded'} ${
                              checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                            }`}
                          >
                            {checked && (single
                              ? <span className="size-2 rounded-full bg-primary-foreground" />
                              : <span className="text-[10px] font-bold leading-none">✓</span>)}
                          </span>
                          <span className="truncate text-sm font-medium">{o.name}</span>
                          {!o.isAvailable && <span className="text-[11px] text-muted-foreground">Unavailable</span>}
                        </span>
                        {o.priceDelta !== 0 && (
                          <span className="shrink-0 text-sm font-medium text-muted-foreground font-tabular-nums">
                            {o.priceDelta > 0 ? `+${money(o.priceDelta)}` : money(o.priceDelta)}
                          </span>
                        )}
                        <input
                          type={single ? 'radio' : 'checkbox'}
                          name={`group-${g.id}`}
                          className="sr-only"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleOption(g, o)}
                        />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        {/* Footer: quantity + add */}
        <div
          className="border-t bg-background px-4 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-full border-2 border-primary bg-background overflow-hidden shrink-0">
              <button
                type="button"
                className="h-11 w-11 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-7 text-center text-sm font-bold text-primary font-tabular-nums">{qty}</span>
              <button
                type="button"
                className="h-11 w-11 grid place-items-center text-primary hover:bg-primary/10 transition-colors"
                onClick={() => setQty((q) => q + 1)}
                aria-label="Increase quantity"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <Button
              className="h-12 flex-1 rounded-full"
              size="lg"
              disabled={!requirementsMet}
              onClick={confirm}
            >
              Add {qty > 1 ? `${qty} ` : ''}· {money(unitPrice * qty)}
            </Button>
          </div>
          {!requirementsMet && (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Make the required selections to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
