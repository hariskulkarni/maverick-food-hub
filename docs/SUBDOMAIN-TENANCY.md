# Per-restaurant subdomains — design & setup

**Question:** When a Super Admin creates a new restaurant, can the platform automatically give it a subdomain (e.g. `italia-pizza.maverickfoodhub.com`) that points to the same Next.js app and serves only that restaurant's surface?

**Answer:** Yes. It's a clean fit because:

1. `Restaurant.slug` is already unique. That's the subdomain label, with zero schema changes.
2. The customer surface already lives at `/r/[slug]/*`. We just need a **middleware rewrite** so `italia-pizza.maverickfoodhub.com/` is internally served by `/r/italia-pizza/`.
3. DNS for "any future subdomain" is a **one-time wildcard record + wildcard TLS cert** — admins never have to touch DNS again.
4. The existing `src/middleware.ts` is the right place to plug in subdomain detection (it already runs on every request).

Here's the full design and what each piece costs to implement.

---

## Architecture options

Three credible designs. The recommendation is **Option A** for Phase 1, with Option C reserved for a Phase 2 "bring your own domain" upgrade.

### Option A — Wildcard subdomain (recommended, zero ops per restaurant)

- One-time DNS record: `*.maverickfoodhub.com  A  <VPS-IP>`
- One-time TLS: a wildcard cert (`*.maverickfoodhub.com`) issued by Let's Encrypt via DNS-01, OR Cloudflare Universal SSL when proxied
- Middleware reads `Host: italia-pizza.maverickfoodhub.com`, extracts `italia-pizza`, and rewrites the request to `/r/italia-pizza`
- **Creating a new restaurant requires no DNS calls, no cert reissuance, no API integration.** The subdomain "just works" the moment the Restaurant row is committed.

### Option B — Per-restaurant DNS API call

- On `Restaurant.create()`: call Cloudflare API to add a CNAME for `<slug>.maverickfoodhub.com` → primary domain
- Provision a TLS cert per-domain (LE rate-limited at 50/week per registered domain — fine until ~50 restaurants/week)
- Heavier: brittle DNS call in the signup flow, must handle retry / rollback

### Option C — Wildcard + custom-domain support

- Wildcard handles the default `<slug>.maverickfoodhub.com` automatically (per Option A)
- When a restaurant wants `order.italiapizza.com`: store it as `Restaurant.customDomain`, run a small **Caddy** in front of nginx that auto-issues TLS per custom domain (Caddy does this natively with ZeroSSL/LE)
- Verify ownership before activation via a TXT record or by serving a magic token at a known path

---

## Implementation plan for Option A

Roughly **half a day** of work end-to-end, split into infra, app, and admin UI.

### 1. Schema (zero changes)

`Restaurant.slug` is already `@unique`. That's the subdomain label. Existing code that scopes by `slug` keeps working.

Optional future-proofing for Option C — add when needed, not now:

```prisma
model Restaurant {
  // ...existing fields
  customDomain String? @unique  // e.g. "order.italiapizza.com"
  domainVerifiedAt DateTime?
}
```

### 2. Middleware — subdomain detection + rewrite

Patch `src/middleware.ts` to recognise the host header and rewrite. The existing role-gate logic stays as-is.

```ts
// Add near the top of middleware():
const host = req.headers.get('host') ?? '';
const APEX = process.env.NEXT_PUBLIC_APEX_DOMAIN ?? 'maverickfoodhub.com';
const isApex = host === APEX || host === `www.${APEX}`;
const subdomain = !isApex && host.endsWith(`.${APEX}`)
  ? host.slice(0, host.length - APEX.length - 1)
  : null;

// Reserved subdomains that should NOT be treated as restaurant slugs.
const RESERVED = new Set(['www', 'admin', 'platform', 'kitchen', 'rider', 'api', 'cdn', 'assets', 'status']);

if (subdomain && !RESERVED.has(subdomain)) {
  // Subdomain customer entry. Rewrite "/" → "/r/<subdomain>", "/cart" → "/cart"
  // (cart is shared), etc. Pages under /r/<slug>/* are already mounted, so
  // we just hoist the slug from the host instead of the path.
  const path = url.pathname;
  if (path === '/' || path === '') {
    url.pathname = `/r/${subdomain}`;
    return NextResponse.rewrite(url);
  }
  // Other customer paths: pass through. The page can read the host via
  // headers() if it needs to scope, but most paths are already slug-aware.
}
```

Where to put it: insert **before** the `ROLE_GATES` check so role gating still sees `/r/<slug>` paths after the rewrite.

A small companion helper for server components:

```ts
// src/server/host.ts
import { headers } from 'next/headers';

export async function currentSubdomain(): Promise<string | null> {
  const h = await headers();
  const host = h.get('host') ?? '';
  const apex = process.env.NEXT_PUBLIC_APEX_DOMAIN ?? 'maverickfoodhub.com';
  if (host === apex || host === `www.${apex}`) return null;
  if (host.endsWith(`.${apex}`)) {
    const sub = host.slice(0, host.length - apex.length - 1);
    return ['www', 'admin', 'platform', 'kitchen', 'rider', 'api'].includes(sub) ? null : sub;
  }
  return null;
}
```

The customer page at `/r/[slug]/page.tsx` keeps working unchanged because the middleware rewrites the URL before Next.js routes it.

### 3. NextAuth cookie domain

Sessions must persist across `italia-pizza.maverickfoodhub.com`, `biryani-zone.maverickfoodhub.com`, and the apex. In `src/server/auth.config.ts` (or wherever NextAuth is configured), set:

```ts
export const authEdgeConfig: NextAuthConfig = {
  // ...
  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        // Critical: leading dot scopes the cookie to apex + every subdomain.
        domain: process.env.NEXTAUTH_COOKIE_DOMAIN ?? undefined,
      },
    },
  },
};
```

Set `NEXTAUTH_COOKIE_DOMAIN=.maverickfoodhub.com` in prod env. In dev (localhost) leave it blank — browsers reject `.localhost`.

### 4. NEXTAUTH_URL

NextAuth's callback URLs use `NEXTAUTH_URL`. For multi-domain, set `NEXTAUTH_URL=https://maverickfoodhub.com` and use the `trustHost: true` option so subdomain logins don't redirect to apex:

```ts
export const authEdgeConfig: NextAuthConfig = {
  trustHost: true,
  // ...
};
```

### 5. Admin UI — show the live URL

In the existing restaurant create/edit form and the restaurants list, surface the live URL as a clickable link:

```tsx
<a href={`https://${restaurant.slug}.${apex}`} target="_blank" rel="noreferrer">
  {restaurant.slug}.{apex} ↗
</a>
```

And in the slug-edit input, render the apex as a suffix so admins instinctively know they're picking the subdomain label:

```tsx
<div className="flex">
  <Input value={slug} onChange={...} className="rounded-r-none" />
  <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 bg-muted text-sm text-muted-foreground">
    .{apex}
  </span>
</div>
```

Also validate the slug at the API level — only lowercase, digits, hyphens; reject the `RESERVED` list above (`www`, `admin`, `platform`, etc.) — so admins can never accidentally claim a routing-critical name.

### 6. Asset URLs

The image uploader already returns absolute URLs (or paths under `/uploads/...`). Two options:

- **Path-relative (works today):** Browsers resolve `/uploads/menu/abc.jpg` against the current host. Each subdomain serves its own copy. Works out of the box but means menu images can technically be served from a "wrong" subdomain (harmless but slightly inelegant).
- **CDN-host (clean):** When Phase 2 swaps to Cloudflare R2, return canonical `https://cdn.maverickfoodhub.com/...` URLs from `src/server/storage.ts`. All subdomains reference the same CDN bucket — no per-tenant asset duplication.

For Phase 1, do nothing. The path-relative behaviour is fine.

---

## Infrastructure setup (one-time)

### Wildcard DNS

In Cloudflare:

```
Type:    A
Name:    *
Content: <your-VPS-IP>
Proxy:   Proxied (orange cloud)
TTL:     Auto
```

Plus the existing apex record:

```
Type:    A
Name:    @
Content: <your-VPS-IP>
Proxy:   Proxied
```

### Wildcard TLS

Two paths:

**a) Cloudflare Universal SSL (zero config):** When proxied through Cloudflare (orange cloud), Cloudflare issues a wildcard cert that covers `*.maverickfoodhub.com` automatically. Origin can use a self-signed cert + "Full (strict)" with Cloudflare Origin CA (free, 15-year cert). This is the path of least resistance.

**b) Let's Encrypt wildcard via DNS-01:** If you'd rather skip Cloudflare proxying, use `certbot` with the Cloudflare DNS plugin:

```sh
sudo apt install -y python3-certbot-dns-cloudflare
echo "dns_cloudflare_api_token = <token>" | sudo tee /etc/letsencrypt/cf.ini
sudo chmod 600 /etc/letsencrypt/cf.ini
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cf.ini \
  -d 'maverickfoodhub.com' \
  -d '*.maverickfoodhub.com'
```

Auto-renew runs in `/etc/cron.d/certbot` by default.

### nginx server block

```nginx
server {
  listen 443 ssl http2;
  server_name maverickfoodhub.com *.maverickfoodhub.com;

  ssl_certificate     /etc/letsencrypt/live/maverickfoodhub.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/maverickfoodhub.com/privkey.pem;

  # The Next.js app on PM2.
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;          # critical — preserves subdomain
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;             # long-lived SSE connections
    proxy_cache off;
  }
}

server {
  listen 80;
  server_name maverickfoodhub.com *.maverickfoodhub.com;
  return 301 https://$host$request_uri;
}
```

The `proxy_set_header Host $host` line is the one that makes middleware see the subdomain.

---

## Local dev story

For local development you have three workable options:

1. **`/etc/hosts` entries** — Add `127.0.0.1 italia-pizza.localhost biryani-zone.localhost` so `http://italia-pizza.localhost:3000` resolves to the dev server. Modern Chrome treats `*.localhost` as loopback automatically (no hosts file edit needed) but Safari/Firefox vary.
2. **`*.lvh.me`** — Free public DNS that resolves any `*.lvh.me` to `127.0.0.1`. `http://italia-pizza.lvh.me:3000` works without any local config.
3. **`*.nip.io`** — `http://italia-pizza.127.0.0.1.nip.io:3000` resolves to `127.0.0.1`.

Update the apex env var:

```
NEXT_PUBLIC_APEX_DOMAIN=lvh.me
NEXTAUTH_COOKIE_DOMAIN=.lvh.me
NEXTAUTH_URL=http://lvh.me:3000
```

Cookies on `.lvh.me` are allowed by all browsers. With this setup the same code runs in dev and prod — only the env var changes.

---

## Edge cases worth handling explicitly

1. **Reserved subdomains.** `www`, `admin`, `platform`, `kitchen`, `rider`, `api`, `cdn` must NEVER be assignable to a Restaurant.slug. Add this to the slug-validation zod schema on the create endpoint.
2. **Slug rename.** If an admin renames a restaurant's slug, the old subdomain stops resolving. Add a `RestaurantSlugAlias` table that tracks redirects:
   ```prisma
   model RestaurantSlugAlias {
     id           String @id @default(cuid())
     oldSlug      String @unique
     restaurantId String
     createdAt    DateTime @default(now())
   }
   ```
   Middleware checks alias first; if found, 301 to the new canonical subdomain.
3. **Apex landing.** The platform marketing home stays on `maverickfoodhub.com`. The middleware passes apex requests through unchanged.
4. **Tenant routes inside admin.** `/admin/*` shouldn't subdomain-rewrite — admins authenticated as `ADMIN` belong to one restaurant via session. Keep the rewrite scoped to customer surfaces only.
5. **Subdomain mismatch.** If a customer is signed in for `restaurant-A` and visits `restaurant-B.maverickfoodhub.com`, the session is fine (same user) but cart should be cleared. Cart is currently global, not per-restaurant — that's a small product decision to make either way.

---

## Migration plan from path-based to subdomain-based

Existing customers may have shared `/r/italia-pizza` links. We don't want to break those.

- **Keep both routes alive.** The `/r/[slug]/*` page tree stays. The middleware only **rewrites** subdomain requests; it doesn't disable path-based access.
- **Canonicalise** with a `<link rel="canonical" href="https://<slug>.<apex>/...">` tag in the page head so search engines learn the new home.
- **301 redirect** from `/r/<slug>` → `https://<slug>.<apex>` after a few weeks once analytics show traffic has shifted.

---

## Cost & timing

| Item | Effort | Cost |
|---|---|---|
| Wildcard DNS record in Cloudflare | 5 min | Free |
| Wildcard TLS cert (Cloudflare Universal SSL) | 0 min — automatic | Free |
| Middleware patch (~40 lines) | ~1 hour | — |
| NextAuth cookie config | ~15 min | — |
| Admin UI surfacing the live URL | ~30 min | — |
| Slug validation against reserved list | ~15 min | — |
| Slug-alias table (for future renames) | ~30 min | — |
| **Total** | **~3 hours** | **₹0 extra/mo** |

For Phase 2 (bring-your-own-domain via Caddy): another ~half day to put Caddy in front of nginx and add a `customDomain` admin wizard.

---

## What "automatic" looks like end-to-end

1. Super Admin opens `/platform/restaurants/new`.
2. Types name "Italia Pizza" — slug auto-derived as `italia-pizza`.
3. Form shows the future URL: `italia-pizza.maverickfoodhub.com` as a live preview.
4. On Save: the Restaurant row commits.
5. The same second, `https://italia-pizza.maverickfoodhub.com` is live — DNS already resolves it (wildcard), TLS already covers it (wildcard cert), middleware already routes it (`slug` lookup against the freshly-inserted row).
6. Admin clicks the link; lands on the freshly created restaurant's customer-facing PWA.

No DNS API calls. No cert reissuance. No restart. No nginx reload. **The "automatic" is that nothing additional needs to happen** — the wildcard infrastructure makes every future restaurant work the instant the row exists.

---

## Recommendation

Implement Option A as described. About 3 hours of focused work. Reuse the existing `/r/[slug]` tree — no surface re-engineering. Defer custom domains (Option C) until a paying restaurant explicitly asks for one; when that day comes, Caddy + a `customDomain` column wraps it cleanly without revisiting any of the wildcard groundwork.
