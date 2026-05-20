/**
 * Unit tests for resolveLineSelections — the pure, server-authoritative variant
 * + modifier resolver used by placeOrder. Pins down:
 *   - variant fallback to default/first when none chosen
 *   - rejecting unknown / unavailable variants
 *   - min/max/required modifier-group enforcement
 *   - rejecting orphan option ids + unavailable options
 *   - the price delta + display snapshots (variantName, modifiersSummary)
 */
import { describe, it, expect } from 'vitest';
import {
  resolveLineSelections,
  MenuSelectionError,
  type VariantLike,
  type GroupLike,
} from '@/server/menu-selections';

const variants: VariantLike[] = [
  { id: 'v-half', name: 'Half', price: 120, isDefault: false, isAvailable: true },
  { id: 'v-full', name: 'Full', price: 220, isDefault: true, isAvailable: true },
  { id: 'v-86', name: 'Family', price: 400, isDefault: false, isAvailable: false },
];

const groups: GroupLike[] = [
  {
    id: 'g-spice',
    name: 'Spice level',
    minSelect: 1,
    maxSelect: 1,
    required: true,
    options: [
      { id: 'o-mild', name: 'Mild', priceDelta: 0, isAvailable: true },
      { id: 'o-hot', name: 'Hot', priceDelta: 0, isAvailable: true },
    ],
  },
  {
    id: 'g-addons',
    name: 'Add-ons',
    minSelect: 0,
    maxSelect: 2,
    required: false,
    options: [
      { id: 'o-cheese', name: 'Extra cheese', priceDelta: 30, isAvailable: true },
      { id: 'o-egg', name: 'Boiled egg', priceDelta: 25, isAvailable: true },
      { id: 'o-gone', name: 'Truffle', priceDelta: 99, isAvailable: false },
    ],
  },
];

describe('resolveLineSelections — variants', () => {
  it('returns null variant when the item has no variants', () => {
    const r = resolveLineSelections('Plain Tea', [], [], {});
    expect(r.variant).toBeNull();
    expect(r.variantName).toBeNull();
  });

  it('falls back to the default available variant when none chosen', () => {
    const r = resolveLineSelections('Biryani', variants, [], {});
    expect(r.variant?.id).toBe('v-full');
    expect(r.variantName).toBe('Full');
  });

  it('honours an explicit valid variant choice', () => {
    const r = resolveLineSelections('Biryani', variants, [], { selectedVariantId: 'v-half' });
    expect(r.variant?.price).toBe(120);
    expect(r.variantName).toBe('Half');
  });

  it('rejects an unknown variant id', () => {
    expect(() => resolveLineSelections('Biryani', variants, [], { selectedVariantId: 'nope' }))
      .toThrow(MenuSelectionError);
  });

  it('rejects an unavailable (86’d) variant', () => {
    expect(() => resolveLineSelections('Biryani', variants, [], { selectedVariantId: 'v-86' }))
      .toThrow(/unavailable/i);
  });

  it('rejects a variant sent for an item that has none', () => {
    expect(() => resolveLineSelections('Plain Tea', [], [], { selectedVariantId: 'v-full' }))
      .toThrow(MenuSelectionError);
  });
});

describe('resolveLineSelections — modifiers', () => {
  it('enforces a required group (must pick at least one)', () => {
    expect(() => resolveLineSelections('Biryani', variants, groups, { selectedVariantId: 'v-full' }))
      .toThrow(/at least 1/i);
  });

  it('enforces maxSelect', () => {
    expect(() =>
      resolveLineSelections('Biryani', variants, groups, {
        selectedVariantId: 'v-full',
        selectedModifierOptionIds: ['o-mild', 'o-cheese', 'o-egg', 'o-hot'],
      })
    ).toThrow(/at most/i);
  });

  it('rejects an option id that is not on this item', () => {
    expect(() =>
      resolveLineSelections('Biryani', variants, groups, {
        selectedVariantId: 'v-full',
        selectedModifierOptionIds: ['o-mild', 'o-bogus'],
      })
    ).toThrow(/not valid/i);
  });

  it('rejects an unavailable option', () => {
    expect(() =>
      resolveLineSelections('Biryani', variants, groups, {
        selectedVariantId: 'v-full',
        selectedModifierOptionIds: ['o-mild', 'o-gone'],
      })
    ).toThrow(/unavailable/i);
  });

  it('sums priceDelta + builds the summary in group/option order', () => {
    const r = resolveLineSelections('Biryani', variants, groups, {
      selectedVariantId: 'v-half',
      selectedModifierOptionIds: ['o-egg', 'o-mild', 'o-cheese'],
    });
    expect(r.modifierDelta).toBe(55); // 30 + 25, mild is 0
    // Order follows groups then options: Spice(Mild) then Add-ons(cheese, egg)
    expect(r.modifiersSummary).toBe('Mild, Extra cheese, Boiled egg');
    expect(r.modifiers.map((m) => m.id)).toEqual(['o-mild', 'o-cheese', 'o-egg']);
  });

  it('leaves summary null when nothing optional is chosen (no required groups)', () => {
    const optional: GroupLike[] = [
      { id: 'g', name: 'Add-ons', minSelect: 0, maxSelect: 3, required: false, options: groups[1].options },
    ];
    const r = resolveLineSelections('Pizza', [], optional, {});
    expect(r.modifierDelta).toBe(0);
    expect(r.modifiersSummary).toBeNull();
  });
});
