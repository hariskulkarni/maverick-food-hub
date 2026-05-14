# Manual Smoke-Test Checklist

Demo-readiness pass for the Restaurant Manager platform. Walk each section top-to-bottom; a green run means everything below is checked. Negative cases are interleaved with the happy paths so we never ship a regression behind a working "good" case.

Seed credentials (from `prisma/seed.ts`):

- Super admin: `super@platform.local` / `Super@12345`
- Restaurant admin (Saffron & Smoke): `admin@restaurant.local` / `Admin@12345`
- Restaurant admin (Bistro Cinque): `admin@bistro-cinque.local` / `Admin@12345`
- Kitchen: `kitchen@restaurant.local` / `Kitchen@12345`
- Customer Priya: phone `+919876500001` (OTP via dev console)
- Rider Sandeep: phone `+919876500011` (OTP via dev console)

---

## Customer

### Home `/`

- [ ] Hero loads with restaurants and combos visible, expect no broken images
- [ ] Click a restaurant card, expect navigation to `/r/<slug>`
- [ ] Featured combo "Biryani Feast" appears, expect price ₹540
- [ ] Open in incognito with no session, expect "Login" CTA in header

### Restaurants list `/restaurants`

- [ ] See 2 ACTIVE restaurants (Saffron & Smoke, Bistro Cinque), expect Spice Route hidden
- [ ] Filter by cuisine "Italian", expect only Bistro Cinque
- [ ] Search "biryani", expect Saffron & Smoke matches by item name

### Restaurant detail `/r/saffron-smoke`

- [ ] Categories list left rail (6 items), expect "Biryani" first
- [ ] Click an item, expect detail/modal with description and price
- [ ] Toggle veg-only filter, expect non-veg items hidden
- [ ] Open Bistro Cinque `/r/bistro-cinque`, expect 12-item Italian menu and pizza images

### Menu `/menu`

- [ ] Add 2× Hyderabadi Biryani to cart, expect cart count = 2 in header
- [ ] Add an unavailable item (toggle in admin first), expect "Out of stock" badge and disabled add button
- [ ] Combo page `/combos` shows Biryani Feast, expect single-click add

### Cart `/cart`

- [ ] Increment a line item, expect subtotal updates without page reload
- [ ] Remove all items, expect empty-cart illustration and "Browse menu" CTA
- [ ] Apply coupon `WELCOME50`, expect ₹50 off applied; minimum order ₹250 enforced
- [ ] Apply bogus coupon `NOPE`, expect inline error "Invalid coupon"

### Login `/login`

- [ ] Enter phone `+919876500001`, expect OTP screen
- [ ] Enter wrong OTP 3 times, expect rate-limit / lockout warning
- [ ] Enter correct OTP, expect redirect to home with name in header
- [ ] Submit empty phone, expect inline validation error

### Checkout `/checkout`

- [ ] As logged-in Priya with default address, expect address card pre-selected
- [ ] Place an order with no address selected (log out, log in fresh customer with no address), expect inline error "Please add a delivery address"
- [ ] Switch to COD, expect "Pay on delivery" confirmation
- [ ] Switch to Razorpay mock, expect mock payment screen → success → order code
- [ ] Order below ₹100 minimum (if enforced), expect blocking error

### Orders `/orders`

- [ ] List shows historic orders sorted newest first, expect status badges (DELIVERED, ACCEPTED, etc.)
- [ ] Click an order row, expect navigation to `/orders/<id>`

### Order detail `/orders/[id]`

- [ ] DELIVERED order shows itemised receipt + delivery photo (if any)
- [ ] Active order shows live status timeline (RECEIVED → ACCEPTED → PREPARING…)
- [ ] OUT_FOR_DELIVERY order shows live tracker map with rider pin
- [ ] Click "Reorder", expect cart populated with same items

### Track order (guest) `/track`

- [ ] Enter valid order code + phone, expect public tracker view
- [ ] Enter mismatched phone, expect "We couldn't find that order"

### Profile `/profile`

- [ ] Default landing shows name, phone, loyalty points, wallet balance
- [ ] Edit name and save, expect toast "Profile updated"
- [ ] Submit empty name, expect inline error

### Addresses `/profile/addresses`

- [ ] List shows default address marked, expect "Home" badge for Priya
- [ ] Add new address `/profile/addresses/new` with all fields, expect new row
- [ ] Add address with empty pincode, expect inline error
- [ ] Delete an address used by an active order, expect blocking confirmation

### Favorites `/profile/favorites`

- [ ] Priya sees Saffron & Smoke favorited, expect Hyderabadi Chicken Biryani in favorite items
- [ ] Unfavorite an item, expect immediate removal from list

### Referrals `/profile/referrals`

- [ ] Page shows referral code + share link, expect copy-to-clipboard works
- [ ] Reward amounts visible (₹100 referrer / ₹50 referred)

### Static pages

- [ ] `/about`, `/contact`, `/privacy`, `/terms` all render without console errors
- [ ] Contact form submit empty, expect inline errors on each required field

### QR landing `/qr/[code]`

- [ ] Scan the seeded RESTAURANT QR code, expect redirect to Saffron & Smoke storefront with QR session tracked
- [ ] Scan the seeded TABLE QR (T-12), expect storefront with "Table T-12" indicator and `scanCount` incremented in DB

---

## Rider

### Rider home `/rider`

- [ ] As Sandeep, log in and see online/offline toggle, expect default offline
- [ ] Toggle online, expect heartbeat ping starts and toast "You're live"
- [ ] No active assignment, expect "Open the pool to claim deliveries" CTA

### Pool `/rider/pool`

- [ ] List shows READY orders within service radius, expect distance + payout per row
- [ ] Claim an order, expect row disappears from pool and shows on home as active
- [ ] Try to claim a second simultaneous order, expect rejection if max load reached
- [ ] Reject a claimed assignment without reason, expect inline reason picker

### Active delivery (rider home with assignment)

- [ ] Click "Reached restaurant", expect status change to RIDER_REACHED_RESTAURANT and SSE pushes to admin
- [ ] Click "Picked up", expect OUT_FOR_DELIVERY status
- [ ] GPS pings emitted every 30s while online, expect rows in `DeliveryLocationPing`
- [ ] Enter wrong delivery OTP 4 times, expect DELIVERY_OTP_FAILED state and escalation raised
- [ ] Mark delivered with correct OTP, expect success + COD prompt if COD order
- [ ] Upload delivery photo, expect attached to assignment

### History `/rider/history`

- [ ] List shows completed assignments, expect filter by date range
- [ ] Click a row, expect breakdown (base + bonus + tip)

### Earnings `/rider/earnings`

- [ ] Week-to-date earnings header visible, expect chart renders
- [ ] Switch to "Last 30 days", expect totals update without reload
- [ ] As Sandeep with 2 pending COD reconciliations totaling ₹450, expect "₹450 cash to deposit" callout

---

## Restaurant Admin

### Admin home `/admin`

- [ ] As `admin@restaurant.local`, see KPI tiles (today's orders, revenue, avg prep time)
- [ ] Sparkline / chart loads without errors
- [ ] Status badge shows "Saffron & Smoke — ACTIVE"

### Orders board `/admin/orders`

- [ ] Columns by status (RECEIVED, ACCEPTED, PREPARING, READY, OUT_FOR_DELIVERY), expect counts in headers
- [ ] Click an order card, expect navigation to `/admin/orders/[id]`
- [ ] Bulk accept all RECEIVED with one click, expect each moves to ACCEPTED
- [ ] Reject a RECEIVED order with reason RESTAURANT_TOO_BUSY, expect CANCELLED_BY_RESTAURANT and refund job queued

### Order detail `/admin/orders/[id]`

- [ ] Full timeline, items, customer info, payment status
- [ ] Trigger manual status advance, expect SSE push to customer tracker
- [ ] Cancel after PREPARING without reason, expect blocking inline error

### Menu `/admin/menu`

- [ ] List shows all 17 items + combo; expect inline image thumbnails
- [ ] Toggle "Available" off on Chicken 65, expect storefront reflects within 5s (SSE/poll)
- [ ] Add new item with empty name, expect inline validation
- [ ] Edit price to a negative value, expect blocking error
- [ ] Delete an item attached to an active order, expect soft-delete or warning

### Branches `/admin/branches`

- [ ] Indiranagar branch shows in list with city + radius
- [ ] Add new branch `/admin/branches/new` with all fields, expect new row
- [ ] Submit with missing pincode/lat/lng, expect inline errors

### Coupons `/admin/coupons`

- [ ] `WELCOME50` listed with usage count
- [ ] Create coupon with overlapping code, expect "Code already exists" error
- [ ] Create coupon with `percentOff` > 100, expect blocking error

### Riders `/admin/riders`

- [ ] List shows platform riders Sandeep + Imran (read-only at restaurant level)
- [ ] Pending rider applications visible, expect "approval is platform-managed" hint

### Settings `/admin/settings`

- [ ] Tabs: Profile, Hours, Tax, Integrations, expect saved values from seed
- [ ] Change tax rate to non-numeric, expect inline error
- [ ] Toggle restaurant "Accepting orders" off, expect storefront banner appears

### Reports `/admin/reports`

- [ ] Date-range picker defaults to last 7 days, expect charts render
- [ ] Export CSV, expect file download

### Live `/admin/live`

- [ ] Live orders feed shows pulse animation on new order
- [ ] Click "Open kitchen view" button, expect new tab to `/kitchen`

---

## Kitchen

### Kitchen board `/kitchen`

- [ ] As `kitchen@restaurant.local`, see ACCEPTED + PREPARING tickets only
- [ ] Click "Start" on an ACCEPTED ticket, expect moves to PREPARING with prep timer ticking
- [ ] Click "Mark ready" on a PREPARING ticket, expect READY and disappears from board (or moves to ready lane)
- [ ] Audio cue / toast on new order arrival
- [ ] Long-press / skip without reason, expect blocking confirmation
- [ ] Filter by category "Biryani" (if available), expect only those tickets

---

## Super Admin

### Platform home `/platform`

- [ ] As `super@platform.local`, see platform KPIs (GMV, restaurants, riders, escalations)
- [ ] Quick-link tiles for each subsection render

### Restaurants `/platform/restaurants`

- [ ] Three rows: Saffron & Smoke (ACTIVE), Bistro Cinque (ACTIVE), Spice Route (PENDING)
- [ ] Approve Spice Route, expect status flips to ACTIVE and audit log row appears
- [ ] Reject (then re-approve) Spice Route with empty reason, expect inline error on reject

### Orders `/platform/orders`

- [ ] Cross-restaurant order feed, expect orders from all three restaurants
- [ ] Filter by status OUT_FOR_DELIVERY, expect Sandeep's active delivery visible

### Riders `/platform/riders`

- [ ] Riders Sandeep + Imran approved, application Vikas T. pending
- [ ] Approve Vikas, expect new RiderProfile created and audit log row
- [ ] Suspend Sandeep, expect cannot claim new assignments (verify in rider session)

### Users `/platform/users`

- [ ] Search "Priya", expect single match with role CUSTOMER
- [ ] Open user detail, expect tabs for orders / wallet / loyalty

### Payouts `/platform/payouts`

- [ ] Default DeliveryPayoutRule v1 visible and Active
- [ ] Edit `peakHourBonus`, save, expect new version effective and audit row
- [ ] Set `maxPerDelivery` < `baseAmount`, expect blocking validation

### COD `/platform/cod`

- [ ] Two PENDING_COLLECTION rows for Sandeep totaling ₹450
- [ ] Mark one COLLECTED, expect status moves and remaining balance recalculates
- [ ] Trigger reconcile with mismatched amount, expect MISMATCH status

### Live ops `/platform/live-ops` and `/platform/live`

- [ ] Two open escalations: ORDER_NOT_ACCEPTED (MEDIUM) and NO_RIDER_AVAILABLE (HIGH)
- [ ] Acknowledge HIGH escalation, expect status ACKNOWLEDGED and resolver = current user
- [ ] Resolve with empty note, expect inline error

### Support `/platform/support`

- [ ] One OPEN ticket from Priya (ORDER_DELAY, HIGH)
- [ ] Assign to current user, expect assignedTo populated
- [ ] Resolve ticket with resolution text, expect status RESOLVED and resolvedAt set

### QR `/platform/qr`

- [ ] Two QR codes for Saffron & Smoke (RESTAURANT and TABLE T-12), expect scan counts visible
- [ ] Create new TABLE QR, expect new short code and downloadable PNG
- [ ] Deactivate a QR, expect /qr/[code] returns 410 or redirects to "expired"

### Analytics `/platform/analytics`

- [ ] Charts: GMV by day, top restaurants, top items, expect data renders
- [ ] Switch range to "All time", expect totals shift

### Reports `/platform/reports`

- [ ] Generate platform settlement report for last 7 days, expect CSV download

### System health `/platform/system-health`

- [ ] Job queue status visible (pending / processing / failed counts)
- [ ] Recent errors list (ErrorLog) visible with timestamps

### Security `/platform/security`

- [ ] 2FA setup card visible, expect QR code for TOTP enrollment
- [ ] IP allowlist editor renders, expect can add CIDR and save
- [ ] Add invalid CIDR like `999.0.0.0/40`, expect inline error

### Audit log `/platform/audit-log`

- [ ] Recent rows visible (restaurant approvals, payout edits)
- [ ] Filter by actor = super admin, expect only their actions

---

## Cross-role realtime (SSE)

- [ ] Tab A: super admin on `/platform/orders`. Tab B: Priya places a new order. Expect new row pops into Tab A within 2 seconds with no manual refresh
- [ ] Tab A: restaurant admin on `/admin/orders`. Tab B: same customer order. Expect card appears in RECEIVED column within 2 seconds
- [ ] Tab A: kitchen on `/kitchen`. Tab B: admin clicks Accept on the new order. Expect ticket appears on kitchen board within 2 seconds with audio cue
- [ ] Tab A: customer on `/orders/[id]`. Tab B: kitchen marks the order PREPARING. Expect timeline updates in Tab A within 2 seconds
- [ ] Place an OUT_FOR_DELIVERY order with Sandeep claimed. Tab A: customer on `/orders/[id]` tracker. Tab B: simulate rider GPS ping (admin tool or rider app). Expect Sandeep's pin moves on the customer's map within 5 seconds
- [ ] Same setup as above. Tab C: super admin on `/platform/live`. Expect Sandeep's pin visible on the platform map alongside customer's tracker view
- [ ] Drop the SSE connection (kill tab network for 5s, restore). Expect tab reconnects automatically and missed events backfill on resume

---

End of checklist. Targeted run time: ~45 minutes for a full top-to-bottom pass with two devices for the realtime section.
