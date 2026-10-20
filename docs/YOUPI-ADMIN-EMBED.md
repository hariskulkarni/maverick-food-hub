# Embed YouPI Admin inside Flavrly super-admin

The super-admin page **Platform → YouPI Admin** (`/platform/youpi-admin`) embeds the
self-hosted YouPI Merchant Admin hub (`https://pay-admin.flavrly.in`, already branded
Flavrly, behind Authelia password + TOTP) in an iframe. No YouPI screens are
reimplemented — the real hub is surfaced in-app.

Security after this change: **double-gated** — Flavrly `SUPER_ADMIN` to reach the page,
then Authelia (password + authenticator) inside the iframe. The only relaxation is that
the YouPI admin and the Authelia portal may now be framed by **one** origin we own,
`https://portal.flavrly.in`, instead of none.

## 1. Flavrly app (code — ships via the normal deploy)

`apps/web/next.config.mjs` adds the YouPI admin origin to the portal CSP `frame-src`
(derived from `NEXT_PUBLIC_YOUPI_ADMIN_URL`, default `https://pay-admin.flavrly.in`).
Without this the **parent** portal CSP blocks the child iframe. No migration; no new env
required if the default subdomain is used.

## 2. VPS reverse proxy (run in the Hostinger console as `deploy`)

The child pages must stop refusing to be framed. Both currently send
`X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. Strip those and re-assert
`frame-ancestors` scoped to the portal.

### 2a. `/etc/nginx/conf.d/youpi.conf` — the `pay-admin.flavrly.in` server, inside its `location /`

```nginx
    # Allow the Flavrly super-admin page to embed this admin hub (and only it).
    proxy_hide_header X-Frame-Options;
    proxy_hide_header Content-Security-Policy;
    add_header Content-Security-Policy "frame-ancestors https://portal.flavrly.in" always;
```

### 2b. `/etc/nginx/conf.d/authelia.conf` — the `auth.flavrly.in` server, inside its `location /`

(Needed so the Authelia login/TOTP step renders inside the iframe on first load or after
session expiry.)

```nginx
    proxy_hide_header X-Frame-Options;
    proxy_hide_header Content-Security-Policy;
    add_header Content-Security-Policy "frame-ancestors https://portal.flavrly.in" always;
```

> Tradeoff: stripping Authelia's own CSP removes its nonce-based `script-src` hardening on
> the login page. TOTP auth still works; acceptable for the single-admin pilot. The added
> `frame-ancestors` still blocks every framer except the portal.

### 2c. Apply

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Authelia and the YouPI pm2 apps do **not** need restarting — only nginx.

## 3. Verify

```bash
# pay-admin no longer DENYs framing; asserts portal as the only ancestor
curl -sS -D - -o /dev/null https://pay-admin.flavrly.in/ | grep -iE 'x-frame-options|content-security-policy'
# auth portal likewise
curl -sS -D - -o /dev/null https://auth.flavrly.in/  | grep -iE 'x-frame-options|content-security-policy'
```

Expect: no `X-Frame-Options` line, and `Content-Security-Policy: frame-ancestors https://portal.flavrly.in`.

Then open `https://portal.flavrly.in/platform/youpi-admin` as a super-admin → the YouPI hub
loads in-frame; first load shows the Authelia login (password + authenticator) inside the
frame. Cookies flow because `portal`, `pay-admin` and `auth` are all `*.flavrly.in`
(same-site). If the frame is blank, re-check that both 2a and 2b were applied and nginx
reloaded.

## Rollback

Remove the three lines from each server block (or restore `add_header ... "frame-ancestors 'none'"`)
and `sudo systemctl reload nginx`. The page still works via its **Open in new tab** link.
