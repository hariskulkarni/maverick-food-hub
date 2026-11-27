# Maintenance / under-construction mode

One switch closes the **whole platform** — `flavrly.in` and
`portal.flavrly.in`, customers and staff alike, up to and including
`SUPER_ADMIN`. It is flipped from a shell on the server. There is no control
for it anywhere in the product.

```bash
cd /opt/restaurant-manager/apps/web

npm run maintenance:status
npm run maintenance:on  -- --message "Upgrading the kitchen. Back by 2am IST."
npm run maintenance:off
npm run maintenance:bypass     # fresh bypass links without touching the flag
```

A flip takes effect within ~10 seconds (see *How it works*). No deploy, no
rebuild, no `pm2 reload`.

## Why there is no admin UI

The switch exists to hold the door shut during a migration or an incident. A
control a signed-in admin can flip is a control anyone holding an admin session
can flip — which is the situation it exists to contain. So it lives behind
shell access, which is a different and much smaller set of people.

## What visitors see

| Request | Response |
|---|---|
| Any page, either hostname | `503` + the branded holding page, at the URL they asked for |
| Any `/api/*` call | `503` + `{"error":"…","code":"service/maintenance"}` |
| `/api/system/health`, `/api/ready` | `200` — unchanged |
| `/api/**/webhook` | passes through — unchanged |
| `/_next/*`, `/uploads/*`, static files | passes through — unchanged |

The holding page is `noindex`, sends `Retry-After: 600`, and is never cached
(`no-store`, including `CDN-Cache-Control` so Cloudflare doesn't hold it after
you reopen).

**Three deliberate exceptions**, each load-bearing:

- **Health and readiness probes stay green.** If they 503'd, pm2 and your
  uptime monitor would conclude the app is dead and start restarting or
  alerting in the middle of a planned window.
- **Payment webhooks still land.** Providers retry, but an order whose capture
  callback never arrives is a customer charged with nothing to show for it.
- **The asset pipeline still serves.** Blocking `/_next/*` would render the
  holding page unstyled — the gate would break the one page it shows.

## The bypass

`maintenance:on` prints two links, one per hostname:

```
customer site  https://flavrly.in/maintenance-bypass?t=<token>&next=/
staff portal   https://portal.flavrly.in/maintenance-bypass?t=<token>&next=/
```

Open each once in the browser you want to test from, and that browser sees the
real site while everyone else gets the holding page. You need both links
because the cookie is **host-only** — the same deliberate isolation the session
cookies use, so a bypass on the storefront can't quietly unlock the admin
console.

The token is HMAC-SHA256 signed with the session secret and carries its own
expiry (12h default, `--hours` to change, 72h max). It cannot be re-dated or
forged, and the cookie it sets expires with it. Drop it early with
`https://<host>/maintenance-bypass?clear=1`.

## How it works

Middleware runs on the **Edge runtime**, where Prisma and the filesystem are
both unavailable — so it can't read the flag directly. Instead:

1. `npm run maintenance:on` writes one row to `PlatformFlag` (`key = 'maintenance'`).
2. `GET /api/system/maintenance` (Node runtime) reads that row.
3. Middleware fetches that endpoint over loopback and caches the result for 10
   seconds, shared across every request (the deployment is a single long-lived
   `next start` process, so a module-level cache is process-wide).

A stale entry is refreshed synchronously rather than served stale, so the
10-second window is the whole delay — not "10 seconds plus one unlucky
request", where the request that slips through is the one you were trying to
stop.

The loopback origin is hardcoded to `http://127.0.0.1:<port>` and must never be
derived from `req.nextUrl`. Next 15.5.28 honours `X-Forwarded-Proto` when
building it, so behind nginx nextUrl reads `https://localhost:3000` — https
scheme, loopback host — and fetching that is TLS against a plain HTTP port.
15.5.18 did not honour the header, so deriving it worked locally and silently
disabled the entire gate in production. Pinned by a unit test
(`loopbackStatusOrigin`), and a failed status read is now logged rather than
swallowed.

### Why its own table

`PlatformFlag` is deliberately **not** the encrypted platform-config blob that
the discovery radius and rider-ops flags use. Writing that blob goes through
`setPlatformSecurity`, which bootstraps a sentinel `Restaurant` row and
therefore requires a `SUPER_ADMIN` user to exist. The switch you reach for
during an incident must not depend on other rows being present, on a foreign
key, or on the encryption key being readable. `PlatformFlag` has no relations
and no encryption — nothing in it is a secret.

### Failure behaviour

Everything fails **open**, in both directions:

- Status endpoint unreachable on first read → treated as "site up". A gate that
  closed the site because it couldn't reach its own status endpoint would be an
  outage with no off switch.
- Status endpoint unreachable later → the last known value is kept. A blip must
  not silently reopen a site that was closed on purpose.
- `PlatformFlag` unreadable (database down) → reported as "not in maintenance".
  The switch to reopen the site lives in that same database, so a read error
  must never be able to close it.

## 404 and 500 pages

Shipped alongside, all branded and `noindex`:

| File | Covers |
|---|---|
| `app/not-found.tsx` | every unmatched URL on both hostnames |
| `app/(customer)/not-found.tsx` | storefront `notFound()` — missing restaurant, dish, order, QR code |
| `app/admin/not-found.tsx`, `app/kitchen/not-found.tsx`, `app/platform/not-found.tsx` | inside each console's chrome |
| `app/global-error.tsx` | root layout crash — last resort |
| `app/(customer)/error.tsx` and siblings | per-segment error boundaries (unchanged; they already report to the observability beacon) |

`global-error.tsx` is styled with inline CSS and imports nothing but the
error beacon. Anything it depends on is something that can take it down with
it, and a broken error page is a blank white screen with no way out.

## Runbook: a planned window

```bash
cd /opt/restaurant-manager/apps/web

# 1. Drain first. Deliveries in flight will be cut off — riders can't mark
#    anything delivered while the API is closed.
npm run maintenance:status

# 2. Close, with a message customers will actually read.
npm run maintenance:on -- --message "Back by 2am IST."

# 3. Open the two bypass links in your browser, confirm you can still work.

# 4. Do the thing. Deploy, migrate, whatever.

# 5. Verify through the bypass, then reopen.
npm run maintenance:off
```

Check for in-flight work first — riders can't complete a handover while the API
is closed. Note the `sed 's/?.*//'`: Prisma's URL carries `?schema=public`,
which `psql` rejects outright.

```bash
DB=$(grep -m1 '^DATABASE_URL' .env | cut -d'"' -f2 | sed 's/?.*//')
psql "$DB" -P pager=off -c "SELECT status, COUNT(*) FROM \"Order\" WHERE status IN
  ('PAYMENT_PENDING','RECEIVED','ACCEPTED','PREPARING','READY','RIDER_ASSIGNED',
   'RIDER_REACHED_RESTAURANT','PICKED_UP','OUT_FOR_DELIVERY','RIDER_REACHED_CUSTOMER')
  GROUP BY status ORDER BY status;"
```

Check it took effect from outside:

```bash
curl -sI https://flavrly.in/ | head -1          # HTTP/2 503
curl -s  https://flavrly.in/api/system/maintenance
curl -sI https://flavrly.in/api/system/health | head -1   # HTTP/2 200
```

Rolling back the deploy does **not** reopen the site: the flag lives in the
database, not in the build. Run `maintenance:off`.
