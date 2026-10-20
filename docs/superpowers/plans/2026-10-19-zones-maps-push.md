# Delivery Zones + Maps/Address + Web Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add typed delivery zones with per-zone economics, OSM-based maps/address upgrades (autocomplete, routed ETA/fee, rich address, geofence arrival), and customer web push — closing the gaps vs Enatega/TastyIgniter while keeping Flavrly's existing dispatch/payments/loyalty lead.

**Architecture:** New `DeliveryZone` model per branch (polygon/circle/pincode, priority first-match, conditional fee brackets + distance tiers). Pure geo utils + a zone engine feed a server-authoritative checkout fee. Maps stay Leaflet/OSM; autocomplete via Photon proxy; routing via a pluggable provider (haversine default, OSRM when `OSRM_URL` set). Web push via `web-push` + VAPID with per-user subscriptions.

**Tech Stack:** Next.js 15, TypeScript, Prisma, PostgreSQL, Leaflet + Leaflet.draw, web-push.

**Spec:** docs/superpowers/specs/2026-10-19-zones-maps-push-design.md

## Global Constraints
- Deploy via `prisma db push` (H29), not migrations. Prisma `validate` + `generate` must pass.
- Server is the source of truth for delivery fee/availability — never trust a client-sent fee.
- All admin endpoints tenant-scoped via `requireManagedRestaurant()`; fail-closed.
- Backward compatible: a branch with NO zones keeps working on `Branch.serviceRadiusKm` + haversine.
- CI gate green: `tsc --noEmit`, `next lint`, `node scripts/check-responsive.mjs` (grid-cols-N needs sm:/md:/lg:; 44px tap targets), `next build`, `vitest`.
- Branded admin UI (LogoMark, text-gradient-brand) consistent with recent redesigns.
- Money amounts in paise (integer) internally where fees are computed; Prisma Decimal for stored minOrder.

## Dependency order / parallelism
- **T1 (schema)** blocks everything (single schema.prisma edit for all 3 subsystems).
- After T1, three independent streams:
  - **Stream A (zones):** T2 → T3 → {T4, T5, T6}
  - **Stream B (maps/address):** {T7, T8, T9, T10} (T9/T10 need T1; otherwise independent of A)
  - **Stream C (push):** T11 → T12
- Streams A/B/C may run in separate worktrees concurrently. Within a stream, order as listed.

---

### Task 1: Schema — zones, rich address, web-push
**Files:** Modify `apps/web/prisma/schema.prisma`. Test: `npx prisma validate` + `npx prisma generate`.
**Produces:** models/enums consumed by all later tasks.
- [ ] Add `enum DeliveryZoneType { POLYGON CIRCLE PINCODE }` and `model DeliveryZone` exactly as in spec §G1 (branchId cascade, name, type, priority Int @default(100), isActive, isDefault, polygon Json?, centerLat/centerLng/radiusKm Float?, pincodes String[] @default([]), feeBrackets Json @default("[]"), distanceTiers Json @default("[]"), minOrder Decimal? @db.Decimal(10,2), etaMinutes Int?, timestamps, @@index([branchId, priority])). Add `deliveryZones DeliveryZone[]` to `model Branch`.
- [ ] On `model Address`: add `landmark String?`, `floor String?`, `instructions String?`, `label AddressLabel?`, `labelName String?`; add `enum AddressLabel { HOME WORK OTHER }`.
- [ ] Add `model WebPushSubscription { id String @id @default(cuid()) userId String endpoint String @unique p256dh String auth String userAgent String? createdAt DateTime @default(now()) user User @relation(fields:[userId], references:[id], onDelete: Cascade) @@index([userId]) }` and back-relation `webPushSubscriptions WebPushSubscription[]` on `model User`.
- [ ] Run `npx prisma validate` (expect "valid") and `npx prisma generate` (expect success). Commit.

### Task 2: Geo utility — point-in-polygon + haversine
**Files:** Create `apps/web/src/server/delivery/geo-util.ts`. Test: `apps/web/__tests__/server/delivery/geo-util.test.ts`.
**Produces:** `pointInPolygon(lng:number, lat:number, ring:[number,number][]):boolean` (ray casting, handles closed/open ring); `haversineKm(a:{lat,lng}, b:{lat,lng}):number`.
- [ ] Write failing tests: point inside a square → true; outside → false; on a vertex and on an edge → deterministic (document the chosen convention); concave polygon notch excluded; haversine of two known coords within 1% of expected.
- [ ] Implement ray-casting + haversine. Pure, no I/O.
- [ ] Tests pass. Commit.

### Task 3: Zone matching + fee engine
**Files:** Create `apps/web/src/server/delivery/zones.ts`. Test: `apps/web/__tests__/server/delivery/zones.test.ts`.
**Consumes:** T2 utils, T1 `DeliveryZone`.
**Produces:** `matchZone(branchId:string, loc:{lat:number,lng:number,pincode?:string}):Promise<DeliveryZone|null>`; `computeZoneDelivery(zone:DeliveryZone, subtotalPaise:number, distanceKm:number):{available:boolean, feePaise:number, minOrderPaise:number, etaMinutes:number}`.
- [ ] Failing tests (mock prisma.deliveryZone.findMany): priority asc first-match across POLYGON/CIRCLE/PINCODE; isDefault fallback when no geometry matches; null when no zones; fee bracket selection (rows by minSubtotal desc, first with subtotal≥threshold), charge -1 ⇒ available:false, charge 0 ⇒ free; distance tier additive (tiers by uptoKm asc, first with distanceKm≤uptoKm); minOrder = max(zone, branch); eta override vs fallback.
- [ ] Implement. `matchZone` loads active zones for branch ordered by priority asc. Parse feeBrackets/distanceTiers from Json defensively.
- [ ] Tests pass. Commit.

### Task 4: Zones admin CRUD API
**Files:** Create `apps/web/src/app/api/admin/delivery-zones/route.ts` (GET list by `?branchId`, POST create) and `.../[id]/route.ts` (PATCH, DELETE). Test: `apps/web/__tests__/server/delivery/zones-api.test.ts`.
**Consumes:** T1 model; `requireManagedRestaurant` from `@/server/tenancy`.
- [ ] Failing tests: non-manager → 403/404 (thrown Response caught → clean status); create validates geometry by type (POLYGON needs ≥3 ring points; CIRCLE needs center+radius>0; PINCODE needs ≥1 pincode); rejects a branchId the caller doesn't manage; PATCH/DELETE scoped to a zone whose branch the caller manages.
- [ ] Implement with the try/catch-thrown-Response pattern used by platform routes. Zod-validate body. Only one `isDefault` per branch (unset others on set).
- [ ] Tests pass. Commit.

### Task 5: Zones admin UI (Leaflet.draw editor, branded)
**Files:** Create zone manager page under `apps/web/src/app/admin/` (follow the storefront/settings route + branding conventions already in the repo — locate the admin settings layout first) + a client component with the map editor. Add `leaflet-draw` dep if not present. Test: component smoke/unit where practical; rely on tsc/lint/guardrail.
- [ ] Zone list table (name, type, priority, active, default) + create/edit drawer.
- [ ] Map editor: Leaflet + Leaflet.draw for POLYGON and CIRCLE; PINCODE = chip input. Fee-bracket repeater, distance-tier repeater, min-order, ETA override, priority, active/default toggles. Calls T4 API.
- [ ] Branded (LogoMark, gradient header), responsive (satisfy `check-responsive.mjs`; all interactive controls ≥44px).
- [ ] tsc/lint/guardrail clean. Commit.

### Task 6: Checkout wiring — zone-based server fee
**Files:** Modify the checkout address validator (locate `apps/web/src/app/api/checkout/validate-address/route.ts` or equivalent). Test: extend its test.
**Consumes:** T3 engine.
- [ ] Failing tests: address in a zone → returns {available, feePaise, minOrderPaise, etaMinutes} from `computeZoneDelivery`; unavailable bracket → rejected with reason; branch with no zones → legacy `serviceRadiusKm` + haversine path unchanged; fee never read from client input.
- [ ] Implement: geocode → {lat,lng,pincode}; `matchZone`; if zone → `computeZoneDelivery`; else legacy path. Thread the resulting fee/min/eta into the existing checkout response shape.
- [ ] Tests pass. Commit.

### Task 7: Address autocomplete proxy (Photon)
**Files:** Create `apps/web/src/server/geo/autocomplete.ts` + an API route proxy; wire the checkout address search box. Test: `apps/web/__tests__/server/geo/autocomplete.test.ts` (mock fetch).
- [ ] `autocomplete(query:string, bias?:{lat,lng}):Promise<{label:string, lat:number, lng:number, pincode?:string}[]>` hitting `PHOTON_URL` (default `https://photon.komoot.io`), India-biased, throttled like the existing Nominatim proxy (reuse its throttle). Server-proxied; client never calls Photon directly.
- [ ] Failing test (mock fetch) → implement → pass. Wire the client search box to the proxy. Commit.

### Task 8: Routing abstraction (haversine default, OSRM pluggable)
**Files:** Create `apps/web/src/server/geo/routing.ts`. Test: `apps/web/__tests__/server/geo/routing.test.ts`.
**Produces:** `routeDistance(from:{lat,lng}, to:{lat,lng}):Promise<{distanceKm:number, durationMin:number, polyline?:string}>`.
- [ ] Failing tests: no `OSRM_URL` → haversine distance + heuristic duration, no polyline; with `OSRM_URL` (mock fetch) → parses `routes[0].distance`/`.duration`/`.geometry`; OSRM error → falls back to haversine (never throws).
- [ ] Implement provider switch. Update the fee/ETA computation (zones + legacy) to use `routeDistance` for distanceKm; pass polyline to the customer tracker payload when present.
- [ ] Tests pass. Commit.

### Task 9: Rich address fields
**Files:** Modify the address form + the create/update address handler + the rider delivery screen (apps/rider-native) to show landmark/floor/instructions. Test: address create/update persists new fields.
**Consumes:** T1 Address fields.
- [ ] Failing test: creating an address with landmark/floor/instructions/label persists and reads back.
- [ ] Add form inputs + saved-address label chips (HOME/WORK/OTHER + custom name). Surface landmark/floor/instructions on the rider delivery screen. 
- [ ] Tests pass; tsc/lint/guardrail clean. Commit.

### Task 10: Geofence arrival events
**Files:** Modify the rider location-ping handler (locate the route that ingests `DeliveryLocationPing`); add arrival detection; emit SSE + OrderStatusEvent note; customer tracker shows arrival. Test: unit on the arrival predicate.
**Consumes:** T2 haversine.
- [ ] Failing tests: ping within `ARRIVAL_RADIUS_M` (default 120) of pickup (branch coords) or dropoff (address coords) emits one `rider_arrived` event per phase (idempotent); outside radius → none; no double-fire.
- [ ] Implement in the ping handler (flag per phase on the assignment/order to ensure once-only). Emit SSE `rider_arrived` {phase:'pickup'|'dropoff'}. Customer tracker renders "Rider has arrived".
- [ ] Tests pass. Commit.

### Task 11: Web push — lib + subscriptions + API
**Files:** Add dep `web-push`. Create `apps/web/src/server/push/webpush.ts` + routes `apps/web/src/app/api/push/vapid-public-key/route.ts`, `.../subscribe/route.ts`, `.../unsubscribe/route.ts`. Test: `apps/web/__tests__/server/push/webpush.test.ts`.
**Consumes:** T1 `WebPushSubscription`.
**Produces:** `sendWebPush(userId:string, payload:{title,body,url?,tag?}):Promise<void>`.
- [ ] Failing tests (mock `web-push`): subscribe persists {endpoint,p256dh,auth} for the session user (upsert by endpoint); unsubscribe deletes; `sendWebPush` fans out to the user's subscriptions and prunes endpoints that return 404/410.
- [ ] Implement with VAPID from `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`. `vapid-public-key` route returns the public key. All require an authenticated session.
- [ ] Tests pass. Commit.

### Task 12: Web push — SW handler + client opt-in + milestone wiring
**Files:** Modify the existing service worker (locate it; the inventory found a registered SW) to add `push` + `notificationclick`; add a client subscribe flow + opt-in toggle in the account/notifications UI; hook `sendWebPush` into order-milestone notifications. Test: milestone fan-out gated by opt-in (mock sendWebPush).
**Consumes:** T11.
- [ ] Failing test: an order milestone (confirmed/preparing/out-for-delivery/arrived/delivered) calls `sendWebPush` for opted-in users only.
- [ ] SW `push` shows a notification from the payload; `notificationclick` focuses/open the order URL. Client: request permission, subscribe via `/api/push/subscribe`, opt-in toggle persists. Wire milestones.
- [ ] Tests pass; tsc/lint/guardrail clean. Commit.

## Deferred / owner infra (not in this plan)
- OSRM container on VPS (India extract + osrm-routed) → set `OSRM_URL`. Haversine until then.
- Optional Photon self-host → set `PHOTON_URL`.
- VAPID keypair generation + VPS env (done at deploy).
- G4 membership loyalty, G5 3PL/ML dispatch.
