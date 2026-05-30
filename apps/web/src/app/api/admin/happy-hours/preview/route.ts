/**
 * POST /api/admin/happy-hours/preview
 *
 * Lets the editor render a live preview of what an unsaved Happy Hour rule
 * would do. Constructs a `HappyHourRuleLite` from the draft, runs the pure
 * `priceForItem` resolver against a synthetic ₹500 sample item, and returns
 * `{ effectivePrice, savings, label }`. No DB writes.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { priceForItem, type HappyHourRuleLite } from '@/server/happy-hours';
import { parseOrJsonError } from '@/server/zod-helpers';

export const dynamic = 'force-dynamic';

const Scope = z.enum(['RESTAURANT', 'CATEGORY', 'MENU_ITEM', 'COMBO']);
const DiscountType = z.enum(['PERCENTAGE', 'FIXED_PRICE', 'FIXED_AMOUNT_OFF']);

const ScheduleRow = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440)
});

const Draft = z.object({
  name: z.string().optional(),
  scope: Scope,
  categoryId: z.string().nullable().optional(),
  menuItemId: z.string().nullable().optional(),
  comboId: z.string().nullable().optional(),
  discountType: DiscountType,
  percentOff: z.number().nullable().optional(),
  fixedPrice: z.number().nullable().optional(),
  amountOff: z.number().nullable().optional(),
  minPrice: z.number().nullable().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().optional(),
  schedules: z.array(ScheduleRow).optional()
});

const Body = z.object({
  draft: Draft,
  sampleItemPrice: z.number().min(0)
});

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  await requireRestaurant();

  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const { draft, sampleItemPrice } = parsed;

  // Build a synthetic HappyHourRuleLite from the draft. We force isActive=true
  // and elastic validity bounds so the preview reflects the intent of the
  // settings rather than "right now is outside the window" edge cases. Window
  // semantics still apply via the `schedules` rows the admin has set.
  const draftRule: HappyHourRuleLite = {
    id: 'preview',
    name: draft.name ?? 'Preview',
    scope: draft.scope,
    categoryId: draft.categoryId ?? null,
    menuItemId: draft.menuItemId ?? null,
    comboId: draft.comboId ?? null,
    discountType: draft.discountType,
    percentOff: draft.percentOff ?? null,
    fixedPrice: draft.fixedPrice ?? null,
    amountOff: draft.amountOff ?? null,
    minPrice: draft.minPrice ?? null,
    validFrom: draft.validFrom ? new Date(draft.validFrom) : new Date(Date.now() - 1000),
    validTo: draft.validTo ? new Date(draft.validTo) : null,
    isActive: draft.isActive ?? true,
    priority: draft.priority ?? 0,
    schedules: draft.schedules ?? []
  };

  // For non-RESTAURANT / non-MENU_ITEM scopes we still want the preview to
  // *fire* so the admin can see the discount math. We feed the synthetic item
  // the matching IDs so ruleAppliesToItem returns true.
  const sampleCategoryId = draft.scope === 'CATEGORY' ? (draft.categoryId ?? 'preview-cat') : null;
  const sampleItemId = draft.scope === 'MENU_ITEM' ? (draft.menuItemId ?? 'preview-item') : 'preview-item';

  // Snapshot rule with categoryId aligned to the sample so it applies.
  const sampleRule: HappyHourRuleLite = {
    ...draftRule,
    categoryId: draftRule.scope === 'CATEGORY' ? (draft.categoryId ?? 'preview-cat') : draftRule.categoryId,
    menuItemId: draftRule.scope === 'MENU_ITEM' ? (draft.menuItemId ?? 'preview-item') : draftRule.menuItemId
  };

  // COMBO scope cannot apply to a menu item — short-circuit with a no-op price.
  if (draft.scope === 'COMBO') {
    return Response.json({
      effectivePrice: sampleItemPrice,
      savings: 0,
      label: null,
      note: 'Combo-scoped rules only affect their specific combo — no price change on individual items.'
    });
  }

  const now = new Date();
  const priced = priceForItem(
    { id: sampleItemId, categoryId: sampleCategoryId, price: sampleItemPrice },
    [sampleRule],
    now
  );

  return Response.json({
    effectivePrice: priced.effectivePrice,
    savings: priced.savings,
    label: priced.label,
    inWindowNow: priced.rule != null
  });
}
