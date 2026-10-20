/**
 * Single source of truth for the zone-authoritative delivery terms of a
 * DELIVERY order. Used by placeOrder (enforcement) and /api/checkout/quote
 * (preview) so the previewed fee always equals the charged fee.
 *
 * Outcomes:
 *  - legacy: branch has no zones => caller keeps the legacy base+perKm fee.
 *  - zone:   serviceable; feeRupees replaces the legacy fee.
 *  - reject: ZONE_UNAVAILABLE (outside all zones with no default, -1 / no
 *            bracket) or MIN_ORDER_NOT_MET.
 */
import { routeDistance } from '../geo/routing';
import { matchZone, computeZoneDelivery, branchHasActiveZones } from './zones';

export type DeliveryTerms =
  | { kind: 'legacy' }
  | { kind: 'zone'; feeRupees: number; minOrderPaise: number; etaMinutes: number; distanceKm: number }
  | { kind: 'reject'; reason: 'ZONE_UNAVAILABLE' | 'MIN_ORDER_NOT_MET'; message: string; minOrderPaise?: number };

export async function resolveDeliveryTerms(args: {
  branch: { id: string; latitude: number | null; longitude: number | null };
  address: { latitude: number | null; longitude: number | null; postalCode?: string | null };
  subtotalPaise: number;
}): Promise<DeliveryTerms> {
  const { branch, address, subtotalPaise } = args;
  let distanceKm = 0;
  if (branch.latitude != null && branch.longitude != null && address.latitude != null && address.longitude != null) {
    ({ distanceKm } = await routeDistance(
      { lat: branch.latitude, lng: branch.longitude },
      { lat: address.latitude, lng: address.longitude }
    ));
  }
  const zone = await matchZone(branch.id, {
    // Address without coordinates: NaN never satisfies a polygon/circle, so only
    // a PINCODE zone or the default zone can match (fail-closed).
    lat: address.latitude ?? Number.NaN,
    lng: address.longitude ?? Number.NaN,
    pincode: address.postalCode ?? undefined
  });
  if (!zone) {
    // Zones configured but this address is outside all of them and there is no
    // default zone => not serviceable. No zones at all => legacy.
    if (await branchHasActiveZones(branch.id)) {
      return { kind: 'reject', reason: 'ZONE_UNAVAILABLE', message: 'ZONE_UNAVAILABLE: this address is outside our delivery area' };
    }
    return { kind: 'legacy' };
  }
  const z = computeZoneDelivery(zone, subtotalPaise, distanceKm);
  if (!z.available) {
    return { kind: 'reject', reason: 'ZONE_UNAVAILABLE', message: 'ZONE_UNAVAILABLE: we do not deliver to this address right now' };
  }
  if (subtotalPaise < z.minOrderPaise) {
    return {
      kind: 'reject',
      reason: 'MIN_ORDER_NOT_MET',
      minOrderPaise: z.minOrderPaise,
      message: `MIN_ORDER_NOT_MET: minimum order for this area is ₹${(z.minOrderPaise / 100).toFixed(2)}`
    };
  }
  return { kind: 'zone', feeRupees: z.feePaise / 100, minOrderPaise: z.minOrderPaise, etaMinutes: z.etaMinutes, distanceKm };
}
