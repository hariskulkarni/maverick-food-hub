# Roadmap & feature status

Pulled directly from the Food Ordering Platform Framework PDF. Status against this build.

## MVP (all done)

| Surface | Feature | Status |
|---|---|---|
| Customer | Browse, filter, search, combos, popular/recommended | ✅ |
| Customer | Cart + coupon + tax + delivery charge calc | ✅ |
| Customer | OTP login, saved addresses, order history, reorder | ✅ |
| Customer | Real-time tracking | ✅ (SSE) |
| Customer | UPI/Card/Wallet/COD payments | ✅ (Razorpay + COD) |
| Customer | WhatsApp + click-to-call support, SMS notifications | ✅ (mock + adapters) |
| Admin | Live orders, accept/reject, status updates | ✅ |
| Admin | Manual rider assignment | ✅ |
| Admin | KOT + invoice print | ✅ |
| Admin | Menu / category / combo CRUD with images | ✅ |
| Admin | Time-based menu availability + item toggle | ✅ |
| Admin | All filters (Pending/Preparing/Completed/Cancelled/COD/Online) | ✅ |
| Admin | Sales/product/rider/payment/customer reports + Excel/CSV/PDF export | ✅ |
| Kitchen | Active orders, prep timer, mark preparing/ready, KOT print, priority highlight | ✅ |
| Rider | OTP login, assigned orders, navigation, call, delivery OTP, mark delivered | ✅ |
| Rider | Earnings + delivery history | ✅ |
| Rider | Mobile responsive web panel | ✅ + PWA installable |
| Notifications | Order placed/accepted/preparing/out/delivered → SMS/WhatsApp/Email | ✅ |
| Admin alerts | New order / failed payment / delivery delay | ✅ |
| Integrations | Razorpay / Maps / WhatsApp / SMS Gateway | ✅ (real + mock) |
| Scalability | Multi-branch, multiple admins, high volume | ✅ |

## Future enhancements (scaffolded, not toy — production-quality)

| Feature | Status |
|---|---|
| Loyalty points | ✅ Schema + accrual on delivered orders + redemption at checkout |
| Wallet system | ✅ Schema + topup + use at checkout + refunds to wallet option |
| Referral system | ✅ Schema + unique codes + reward both parties on first paid order |
| Live GPS tracking | ✅ Rider streams location, customer map updates over SSE |
| AI-based rider allocation | ✅ Distance + load + ETA scoring; pluggable scorer interface for future ML |
| Inventory management | ✅ Item stock + auto-decrement on order completion + low-stock alerts |
| Franchise / multi-branch | ✅ Built into schema from day one — `Branch` aggregate everywhere |
| Native Android/iOS | ✅ Capacitor wrapper for the rider PWA — see `apps/android-rider/`. iOS same setup if needed. |

## Post-pivot additions (2026-05-10 late afternoon)

| Feature | Status |
|---|---|
| Multi-tenant marketplace | ✅ Restaurant entity, super-admin approval, restaurants self-onboard at `/signup/restaurant` |
| Customer restaurant discovery | ✅ `/restaurants` + `/r/[slug]` per-restaurant menu |
| Platform-managed rider pool | ✅ Riders are platform-wide, not restaurant-scoped. READY orders enter a shared pool any rider can claim |
| Rider self-claim from pool | ✅ `/rider/pool` — first-come-first-served, atomic claim |
| Delivery payout rules | ✅ `/platform/payouts` — base + per-km + peak/rain bonus, super-admin sets |
| Proof-of-delivery photo | ✅ Native camera capture in rider app, uploaded at the door |
| Customer tipping | ✅ Post-delivery tip card on the order tracker, 100% to rider |
| Restaurant top-sellers ad strip | ✅ `/r/[slug]` shows 4 most-ordered items in past 30 days |
| Deep platform analytics | ✅ `/platform/analytics` — GMV, top restaurants/products, peak hours, payment mix, rider leaderboard |
| Free OSM live map | ✅ Leaflet + OpenStreetMap, no Google billing |
