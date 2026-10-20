import type { DeliveryZone } from "@prisma/client";
import { prisma } from "../db";
import { haversineKm, pointInPolygon } from "./geo-util";

/**
 * Delivery zone matching and fee engine.
 *
 * MONEY UNITS (contract for the admin UI / zone API):
 *  - feeBrackets[].minSubtotal and feeBrackets[].charge are stored in PAISE.
 *  - distanceTiers[].charge is stored in PAISE; uptoKm is kilometres.
 *  - feeBrackets charge: -1 => delivery unavailable, 0 => free delivery.
 *  - DeliveryZone.minOrder is the existing DB Decimal(10,2) in RUPEES; it is
 *    converted to paise here (x100). Branch minimum is passed in paise.
 */

export interface DeliveryLoc {
  lat: number;
  lng: number;
  pincode?: string;
}

export interface ZoneDelivery {
  available: boolean;
  feePaise: number;
  minOrderPaise: number;
  etaMinutes: number;
}

/** Fallback ETA when a zone has no etaMinutes: 20 min base + 4 min per km. */
export const DEFAULT_ETA_BASE_MINUTES = 20;
export const DEFAULT_ETA_PER_KM_MINUTES = 4;

function zoneContains(zone: DeliveryZone, loc: DeliveryLoc): boolean {
  switch (zone.type) {
    case "POLYGON": {
      const ring = parseRing(zone.polygon);
      return ring ? pointInPolygon(loc.lng, loc.lat, ring) : false;
    }
    case "CIRCLE":
      if (zone.centerLat == null || zone.centerLng == null || zone.radiusKm == null) return false;
      return (
        haversineKm({ lat: loc.lat, lng: loc.lng }, { lat: zone.centerLat, lng: zone.centerLng }) <=
        zone.radiusKm
      );
    case "PINCODE":
      return !!loc.pincode && zone.pincodes.includes(loc.pincode);
    default:
      return false;
  }
}

function parseRing(v: unknown): [number, number][] | null {
  if (!Array.isArray(v)) return null;
  const ring: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") return null;
    ring.push([p[0], p[1]]);
  }
  return ring;
}

/** First active zone (priority asc) containing the location, else the first active default zone, else null. */
export async function matchZone(branchId: string, loc: DeliveryLoc): Promise<DeliveryZone | null> {
  const zones = await prisma.deliveryZone.findMany({
    where: { branchId, isActive: true },
    orderBy: { priority: "asc" },
  });
  for (const z of zones) if (zoneContains(z, loc)) return z;
  return zones.find((z) => z.isDefault) ?? null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseRows<K extends string>(json: unknown, keys: [K, "charge"]): Array<Record<K | "charge", number>> {
  if (!Array.isArray(json)) return [];
  const out: Array<Record<K | "charge", number>> = [];
  for (const r of json) {
    if (!r || typeof r !== "object") continue;
    const a = num((r as Record<string, unknown>)[keys[0]]);
    const c = num((r as Record<string, unknown>).charge);
    if (a === null || c === null) continue;
    out.push({ [keys[0]]: a, charge: c } as Record<K | "charge", number>);
  }
  return out;
}

/**
 * Compute delivery terms for a matched zone. Amounts in paise (see header).
 * @param branchMinOrderPaise optional branch-level minimum; result is max(zone, branch).
 */
export function computeZoneDelivery(
  zone: DeliveryZone,
  subtotalPaise: number,
  distanceKm: number,
  branchMinOrderPaise = 0,
): ZoneDelivery {
  const minOrderPaise = Math.max(
    zone.minOrder == null ? 0 : Math.round(Number(zone.minOrder) * 100),
    branchMinOrderPaise,
  );
  const etaMinutes =
    zone.etaMinutes ??
    Math.round(DEFAULT_ETA_BASE_MINUTES + DEFAULT_ETA_PER_KM_MINUTES * Math.max(0, distanceKm));

  const brackets = parseRows(zone.feeBrackets, ["minSubtotal", "charge"]).sort(
    (a, b) => b.minSubtotal - a.minSubtotal,
  );
  const bracket = brackets.find((b) => subtotalPaise >= b.minSubtotal);
  if (bracket && bracket.charge < 0) {
    return { available: false, feePaise: 0, minOrderPaise, etaMinutes };
  }
  let feePaise = bracket ? bracket.charge : 0;

  const tiers = parseRows(zone.distanceTiers, ["uptoKm", "charge"]).sort((a, b) => a.uptoKm - b.uptoKm);
  const tier = tiers.find((t) => distanceKm <= t.uptoKm);
  if (tier && tier.charge > 0) feePaise += tier.charge;

  return { available: true, feePaise, minOrderPaise, etaMinutes };
}
