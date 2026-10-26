import { z } from "zod";

/**
 * Validation for delivery zone create/patch bodies.
 *
 * MONEY UNITS (must match the engine in zones.ts):
 *  - feeBrackets[].minSubtotal / .charge and distanceTiers[].charge: PAISE (integers).
 *    A bracket charge of -1 means delivery unavailable, 0 means free.
 *  - distanceTiers[].uptoKm: kilometres.
 *  - minOrder: RUPEES (stored in Decimal(10,2)).
 * Polygon points are [lng, lat] pairs.
 */
const FeeBracket = z.object({
  minSubtotal: z.number().int().min(0),
  charge: z.number().int().min(-1),
});
const DistanceTier = z.object({
  uptoKm: z.number().positive(),
  charge: z.number().int().min(0),
});
const Point = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const ZoneBody = z
  .object({
    branchId: z.string().min(1),
    name: z.string().trim().min(1).max(80),
    type: z.enum(["POLYGON", "CIRCLE", "PINCODE"]),
    priority: z.number().int().min(0).max(100000).optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    polygon: z.array(Point).nullish(),
    centerLat: z.number().min(-90).max(90).nullish(),
    centerLng: z.number().min(-180).max(180).nullish(),
    radiusKm: z.number().nullish(),
    pincodes: z.array(z.string().trim().min(1).max(12)).optional(),
    feeBrackets: z.array(FeeBracket).optional(),
    distanceTiers: z.array(DistanceTier).optional(),
    minOrder: z.number().min(0).max(99999999).nullish(),
    etaMinutes: z.number().int().min(1).max(1440).nullish(),
  })
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.type === "POLYGON" && (!v.polygon || v.polygon.length < 3)) bad("polygon", "Polygon needs at least 3 points");
    if (v.type === "CIRCLE") {
      if (v.centerLat == null) bad("centerLat", "centerLat required");
      if (v.centerLng == null) bad("centerLng", "centerLng required");
      if (v.radiusKm == null || !(v.radiusKm > 0)) bad("radiusKm", "radiusKm must be > 0");
    }
    if (v.type === "PINCODE" && (!v.pincodes || v.pincodes.length < 1)) bad("pincodes", "At least one pincode required");
  });

export type ZoneInput = z.infer<typeof ZoneBody>;

/** Shown when a save would leave a zone with no fee brackets (it would refuse every delivery). */
export const NO_BRACKETS_MESSAGE = "Add at least one fee bracket. A zone without fee brackets refuses every delivery.";

/**
 * Default bracket for a zone created without any: every subtotal from ₹0 pays
 * the branch's base delivery fee (rupees → paise). The engine fails closed on
 * an empty bracket list, so a new zone would otherwise refuse every order.
 */
export function defaultFeeBrackets(baseDeliveryFeeRupees: number): Array<{ minSubtotal: number; charge: number }> {
  const charge = Math.max(0, Math.round((Number(baseDeliveryFeeRupees) || 0) * 100));
  return [{ minSubtotal: 0, charge }];
}

/** Prisma data for a validated zone (only fields relevant to the type are kept; others cleared). */
export function zoneData(v: ZoneInput) {
  return {
    branchId: v.branchId,
    name: v.name,
    type: v.type,
    ...(v.priority !== undefined && { priority: v.priority }),
    ...(v.isActive !== undefined && { isActive: v.isActive }),
    ...(v.isDefault !== undefined && { isDefault: v.isDefault }),
    polygon: v.type === "POLYGON" ? v.polygon! : (null as unknown as undefined),
    centerLat: v.type === "CIRCLE" ? v.centerLat! : null,
    centerLng: v.type === "CIRCLE" ? v.centerLng! : null,
    radiusKm: v.type === "CIRCLE" ? v.radiusKm! : null,
    pincodes: v.type === "PINCODE" ? v.pincodes! : [],
    ...(v.feeBrackets !== undefined && { feeBrackets: v.feeBrackets }),
    ...(v.distanceTiers !== undefined && { distanceTiers: v.distanceTiers }),
    ...(v.minOrder !== undefined && { minOrder: v.minOrder }),
    ...(v.etaMinutes !== undefined && { etaMinutes: v.etaMinutes }),
  };
}
