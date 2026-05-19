# Authgear Sandbox

A non-destructive evaluation of [Authgear](https://github.com/authgear/authgear-server) — open-source Auth0/Clerk alternative with MFA, OTP, passkeys, passwordless, SSO, and SAML.

This sandbox lets you **try Authgear without changing anything in production auth**. NextAuth (phone-OTP for customers, email+Argon2id for staff, Bearer JWT for riders) keeps working exactly as today. Authgear's provider is gated behind environment variables — invisible until you flip them.

## Setup paths

There are two ways to get an Authgear server you can point the Restaurant Manager at. **Strongly recommended for "just exploring": Authgear Cloud free tier.** The self-host path requires building the Go server from source (Authgear's open-source distribution does not publish public Docker images for the server itself).

| Path | Time to working | When to pick it |
|---|---|---|
| **Authgear Cloud free tier** (recommended) | ~5 min | Evaluating features. No infra to manage, hosted by Authgear, free for development. |
| **Self-host from source** | ~45-60 min | You've decided to adopt Authgear and need full control over data residency / customisation. |

---

## Path 1 — Authgear Cloud (recommended, ~5 min)

### 1. Sign up

Open <https://www.authgear.com> → **Get Started** → create an account. Free tier covers evaluation and small production use.

You land in the Authgear Portal. Create a project — name it whatever (`reshee-test` is fine). The project slug becomes part of the OIDC issuer URL.

### 2. Configure login methods (Portal sidebar)

**Authentication → Login Methods** — pick what you want to test. Common combinations:
- Email + Password (with optional MFA)
- Phone + OTP (passwordless)
- Email + magic-link OTP
- Social: Google, Apple, Facebook, GitHub (each takes ~2 min to wire up in the same portal)

**Authentication → 2FA** — toggle **Require 2FA** if you want to force MFA. Factors: TOTP (Google Authenticator), SMS OTP, email OTP.

**Authentication → Passkeys** — enable for biometric / security-key login.

### 3. Create an OAuth/OIDC client

**Applications → Add Application** → **OIDC client** (web)

Redirect URIs:
- `http://localhost:3000/api/auth/callback/authgear` (local dev)
- `http://148.230.66.124/api/auth/callback/authgear` (VPS, optional)

Save. The portal shows you:
- **Issuer URL** — looks like `https://<your-project>.authgear.cloud` or similar
- **Client ID**
- **Client Secret**

### 4. Wire it into the Restaurant Manager

Edit `apps/web/.env.local` (create it if missing) and add:

```bash
AUTHGEAR_ENABLED=true
AUTHGEAR_ISSUER=https://<your-project>.authgear.cloud
AUTHGEAR_CLIENT_ID=<from step 3>
AUTHGEAR_CLIENT_SECRET=<from step 3>
```

Restart your dev server (`npm run dev`). NextAuth auto-discovers the OIDC config from the issuer's `/.well-known/openid-configuration` endpoint.

### 5. Try the flow

Open <http://localhost:3000/login/authgear>. Click **Sign in with Authgear**. You redirect to Authgear's hosted AuthUI, sign up or log in using whichever methods you enabled, bounce back to the Restaurant Manager, and see a JSON dump of the claims (sub, email, email_verified, phone_number, name) at `/login/authgear/result`.

---

## Path 2 — Self-host from source (~45-60 min)

Authgear's OSS distribution requires building from source. Their `docker-compose.yaml` in the upstream repo only provides the dependencies (Postgres, Redis, Elasticsearch, nginx); the Authgear server itself is a Go binary you build locally.

If you want to go this route, the steps are roughly:

```bash
# 1. Clone the upstream repo
git clone https://github.com/authgear/authgear-server.git
cd authgear-server

# 2. Bring up the dependency stack (postgres + redis + elasticsearch + nginx)
docker compose up -d postgres16 pgbouncer redis elasticsearch proxy minio

# 3. Install Go (1.22+) and Node.js (for the AuthUI/Portal frontends)
# Follow tooling versions in .tool-versions

# 4. Build all the things
make build

# 5. Initialise config + run migrations
./dist/authgear setup

# 6. Run the server
./dist/authgear start

# (Repeat for portal and admin API binaries)
```

Full instructions: <https://docs.authgear.com/deployment/local-development/local>. Production is officially supported via [Helm chart](https://docs.authgear.com/deployment/production-deployment/helm).

The `docker-compose.yml` I originally shipped in this folder referenced `ghcr.io/authgear/authgear-*` images that don't exist publicly — I've left it as a placeholder reference but **it won't run as-is**. Use the upstream repo if you go this route.

---

## What's wired in the Restaurant Manager

Once you have an Authgear server (Cloud or self-hosted) + the four env vars set:

- **`apps/web/src/server/auth.ts`** — registers an OIDC provider with id `'authgear'`, gated by `AUTHGEAR_ENABLED=true`. Self-disables when any of the four env vars is missing, so a prod build without the env vars exposes nothing.
- **`/login/authgear`** — sandbox start page. Shows provider status + "Sign in with Authgear" button + your current NextAuth session.
- **`/login/authgear/result`** — post-redirect landing page. Dumps the session JSON (sub, email, name) so you can see what Authgear returned.

## What's NOT wired

- No User row is created or linked in the Restaurant Manager DB. The test page is observation-only.
- No existing flow changes — customer phone-OTP, staff email+Argon2id, rider Bearer-JWT, Google OAuth all keep working unchanged.
- Production env on the VPS has `AUTHGEAR_ENABLED` unset; the provider doesn't exist there.

## If you decide to adopt Authgear for real

Migration order (lowest blast-radius first):

1. **Super-admin** — smallest user count, MFA wanted there anyway. Add `authgearSub` column on User, send "claim your Authgear account" email to each super-admin, link in the NextAuth `signIn` callback.
2. **Restaurant admin** — same pattern.
3. **Kitchen** — same.
4. **Customer** — highest blast-radius. Roll out gradually with a feature flag per tenant.

Riders stay on the Bearer JWT in the native app (Authgear has an SDK for React Native, but rider auth is fast + stable, no reason to migrate it).

Estimate: ~3 days of focused work to migrate all roles + 1-week soak running both auths in parallel before removing legacy code.

## Tearing down

Disable the sandbox without removing the code:

```bash
# In apps/web/.env.local, either delete the AUTHGEAR_* vars or:
AUTHGEAR_ENABLED=false
```

Restart the dev server. The provider self-disables and `/login/authgear` shows "not configured". The code is safe to leave in place — dead code when the flag is off.

Full removal (delete every Authgear-related file):

```bash
rm -rf deploy/authgear apps/web/src/app/login/authgear
# Then remove the conditional provider block in apps/web/src/server/auth.ts
```
