# Delivery Zones + Maps/Address + Web Push — Design Spec

**Date:** 2026-10-19
**Status:** Approved scope (G1+G2+G3; maps stack = OSM/self-host). G4 membership + G5 3PL/ML deferred.
**Spec basis:** gap matrix (scratchpad/gaps/GAP-MATRIX.md); copy TastyIgniter `location_areas` zone economics + Enatega polygon zones; keep Flavrly's existing Leaflet/OSM/SSE stack.

## Global constraints
- Next.js 15 / TS / Prisma / Postgres. Deploy by `prisma db push` (H29), NOT migrations.
- Tenant-scoped + fail-closed: all admin endpoints via `requireManagedRestaurant()`; zones/addresses scoped by branch/user.
- Server is source of truth for delivery fee & availability — never trust a client-sent fee (Enatega's weakness).
- Branding: zone admin UI matches Flavrly (LogoMark, text-gradient-brand), consistent with recent storefront/settings redesigns.
- CI gate must stay green: tsc --noEmit, next lint, node scripts/check-responsive.mjs (grid-cols-N needs sm:/md:/lg:, 44px tap targets), next build, vitest.
- Backward compatible: branches with NO zones defined keep working on `Branch.serviceRadiusKm`.

## G1 — Typed Delivery Zones

### Data model (schema.prisma)
```
enum DeliveryZoneType { POLYGON CIRCLE PINCODE }
model DeliveryZone {
  id            String          @id @default(cuid())
  branchId      String
  branch        Branch          @relation(fields:[branchId], references:[id], onDelete: Cascade)
  name          String
  type          DeliveryZoneType
  priority      Int             @default(100)   // lower = checked first
  isActive      Boolean         @default(true)
  isDefault     Boolean         @default(false) // fallback when no geometry matches
  // geometry (by type)
  polygon       Json?           // GeoJSON ring: [[lng,lat],...] (first==last)
  centerLat     Float?
  centerLng     Float?
  radiusKm      Float?
  pincodes      String[]        @default([])
  // economics
  feeBrackets   Json            @default("[]")  // [{minSubtotal:number, charge:number}] charge -1=unavailable,0=free; first row with subtotal>=minSubtotal (rows desc) wins
  distanceTiers Json            @default("[]")  // [{uptoKm:number, charge:number}] additive; first tier with distanceKm<=uptoKm
  minOrder      Decimal?        @db.Decimal(10,2)
  etaMinutes    Int?            // per-zone ETA override
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  @@index([branchId, priority])
}
```
Add `deliveryZones DeliveryZone[]` back-relation on Branch.

### Matching + fee (server/delivery/zones.ts)
- `pointInPolygon(lng,lat, ring)` — ray-casting util (own file server/delivery/geo-util.ts, unit-tested with known polys + edge/vertex cases).
- `matchZone(branchId, {lat,lng,pincode?}) -> DeliveryZone|null`: active zones sorted by priority asc; first match by type (POLYGON: pointInPolygon; CIRCLE: haversineKm<=radiusKm; PINCODE: pincodes.includes(pincode)); else first `isDefault`; else null.
- `computeZoneDelivery(zone, subtotalPaise, distanceKm) -> {available:boolean, feePaise:number, minOrderPaise:number, etaMinutes:number}`:
  - bracket: rows sorted by minSubtotal desc, first with subtotal>=minSubtotal; charge -1 => available:false; else base=charge.
  - +distance tier: tiers sorted by uptoKm asc, first with distanceKm<=uptoKm; add its charge (no tier => 0).
  - minOrder = max(zone.minOrder ?? 0, branch.minOrder ?? 0).
  - eta = zone.etaMinutes ?? existing branch heuristic.
- No zones for branch => return null from matchZone so caller falls back to legacy serviceRadiusKm path.

### Admin (apps/web/src/app/admin/.../delivery-zones)
- Zone manager page per branch: table (name, type, priority, active, default), create/edit drawer.
- Map editor with **Leaflet.draw** (polygon + circle); PINCODE = chip input. Priority numeric; fee-bracket + distance-tier repeaters; min-order; ETA override; active/default toggles.
- Branded (LogoMark, gradient header), responsive (guardrail-compliant).

### API (tenant-scoped, requireManagedRestaurant)
- `GET/POST /api/admin/delivery-zones` (list/create for a branchId), `PATCH/DELETE /api/admin/delivery-zones/[id]`. Validate geometry by type; reject cross-branch.

### Checkout wiring
- `api/checkout/validate-address`: geocode→{lat,lng,pincode}; `matchZone`; if zone => `computeZoneDelivery` (available/fee/min/eta); if unavailable => reject with reason; if matchZone null => legacy serviceRadiusKm+haversine path (unchanged). Fee always computed server-side.

## G2 — Maps & Address (OSM/self-host)

### Autocomplete (server/geo/autocomplete.ts)
- Photon provider (env PHOTON_URL, default public komoot), proxied + throttled like existing Nominatim proxy, India-biased (lat/lon bias to branch). Client address search box calls our proxy, not Photon directly.

### Routing abstraction (server/geo/routing.ts)
- `routeDistanceKm(from, to) -> {distanceKm, durationMin, polyline?}`. Provider interface; default = haversine (current behavior). OSRM provider when `OSRM_URL` set (GET /route/v1/driving/...; parse distance/duration/geometry). Fee + ETA use this; polyline passed to customer tracker when available.
- OSRM container provisioning on VPS = deploy-time infra step (India extract + osrm-routed), done at deploy, not in code. Haversine fallback keeps prod correct if OSRM down.

### Rich address (Address model + checkout form)
- Add `landmark String?`, `floor String?`, `instructions String?`, `label AddressLabel?` enum {HOME WORK OTHER}, `labelName String?`. Form fields + saved-address label chips. Rider delivery screen surfaces landmark/floor/instructions.

### Geofence arrival events
- In rider ping handler: when ping within `ARRIVAL_RADIUS_M` (default 120m) of pickup (branch) or dropoff (address) and not already flagged, emit an OrderStatusEvent note + SSE `rider_arrived` event (pickup|dropoff). Idempotent (one per phase). Customer tracker shows "Rider has arrived".

## G3 — Customer Web Push

### Data + lib
- `model WebPushSubscription { id, userId, endpoint @unique, p256dh, auth, userAgent?, createdAt; user @relation }`.
- Add dep `web-push`. Env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. server/push/webpush.ts: `sendWebPush(userId, payload)` (prune 404/410 endpoints).

### Client + wiring
- Existing SW gains a `push` + `notificationclick` handler. Client subscribe flow (permission prompt, opt-in toggle in account/notifications). `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`.
- Hook `sendWebPush` into order-milestone notifications (confirmed, preparing, out-for-delivery, arrived, delivered), respecting opt-in.

## Testing
- zones: pointInPolygon (inside/outside/vertex/edge), matchZone priority order + default fallback + type dispatch, computeZoneDelivery brackets (-1 unavailable, 0 free, threshold selection) + distance tiers + min-order max + eta override, checkout validate-address zone + legacy fallback.
- routing: haversine default; OSRM provider parse (mocked fetch); fee/eta use routed distance.
- push: subscribe/unsubscribe persistence, dead-endpoint pruning, opt-in gating, milestone fan-out (mocked web-push).
- address: new fields persist + render on rider screen.
- geofence: arrival fires once per phase within radius, not outside.

## Deferred / owner infra
- OSRM container on VPS (India extract). Photon self-host (optional; public default works).
- VAPID keypair generation (I generate + set on VPS at deploy).
- G4 membership, G5 3PL/ML dispatch.
