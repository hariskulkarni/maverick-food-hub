# Authgear Sandbox

A non-destructive evaluation of [Authgear](https://github.com/authgear/authgear-server) — an open-source Auth0/Clerk alternative with MFA, OTP, passkeys, passwordless, SSO, SAML, and OIDC out of the box. License: Apache 2.0.

This sandbox lets you **try Authgear without changing anything in production auth**. NextAuth (phone-OTP for customers, email+Argon2id for staff, Bearer JWT for riders) keeps working exactly as today. Authgear runs alongside it on a separate port, gated behind environment variables.

## What you can evaluate

- **Login methods:** email+password, magic-link, SMS/email OTP, passkeys, social SSO (Google/Apple/Facebook/…)
- **MFA:** TOTP (Google Authenticator / Authy), SMS OTP, email OTP, additional password
- **B2B:** SAML, ADFS, LDAP enterprise connections
- **Account portal:** pre-built user settings page (change password, manage MFA, sessions, devices)
- **Admin portal:** GUI for user management, monitoring, audit logs, login analytics
- **Hooks:** webhooks + TypeScript hooks on signup / login / etc.

## Quick start (15 minutes)

### 1. Bring up Authgear

```bash
cd "/path/to/Restaurant Manager"
docker compose -f deploy/authgear/docker-compose.yml up -d
```

Wait ~30 seconds for postgres + authgear server + portal to start. Then check:

```bash
docker compose -f deploy/authgear/docker-compose.yml ps
```

All three services should be `healthy` or `running`.

### 2. Create a project in the portal

Open <http://localhost:3110> in your browser. The portal will walk you through:

- Sign up as the operator (your email + a strong password — this is *your* admin login, separate from end-user accounts)
- Create a new project. Name it whatever — e.g. `reshee-test`. The project slug becomes part of the OIDC issuer URL.
- The portal lands on the project dashboard.

### 3. Configure login methods

In the portal:

**Authentication → Login Methods**

- Enable **Email** and **Phone**.
- Under "How users sign in", pick the combinations you want to test. The most common is:
  - Email + Password (with optional MFA)
  - Phone + OTP (passwordless)
  - Email + magic-link OTP

**Authentication → 2FA**

- Toggle **Require 2FA** if you want to force MFA.
- Allowed factors: TOTP (recommended for super-admins), SMS OTP, email OTP.

**Authentication → Passkeys**

- Enable passkeys if you want to test the biometric/security-key flow.

### 4. Create an OAuth client (so the Restaurant Manager can use Authgear)

In the portal:

**Applications → Add Application** → pick **OIDC client** (web app)

Fill in:

- **Redirect URIs:** add `http://localhost:3000/api/auth/callback/authgear` (for local dev) and `http://148.230.66.124/api/auth/callback/authgear` (for VPS sandboxing if you want it accessible there too).
- Save.

The portal will show you a **Client ID** and a **Client Secret**. Copy both.

Also note the **Issuer URL** — it'll be something like `http://localhost:3100/<project-slug>`.

### 5. Wire Authgear into the Restaurant Manager web app

Edit `apps/web/.env.local` (create it if it doesn't exist) and add:

```bash
AUTHGEAR_ENABLED=true
AUTHGEAR_ISSUER=http://localhost:3100/<project-slug>
AUTHGEAR_CLIENT_ID=<from step 4>
AUTHGEAR_CLIENT_SECRET=<from step 4>
```

Restart `npm run dev` (or `pm2 restart rm-web` on the VPS) so the new env vars are picked up. NextAuth will auto-discover the OIDC config from the issuer's `/.well-known/openid-configuration` endpoint.

### 6. Try the test flow

Open <http://localhost:3000/login/authgear> in your browser. Click **Sign in with Authgear**. You'll be redirected to Authgear's hosted login UI (AuthUI), where you can sign up or log in using whichever methods you enabled in step 3. After successful login, you bounce back to the Restaurant Manager and see a JSON blob of the claims Authgear returned (`sub`, `email`, `email_verified`, `phone_number`, `name`, `amr` — the auth methods used, including any MFA factors).

That's the sandbox. From here you can:

- Configure webhooks (Authgear portal → Hooks) and see them fire when you sign up
- Add social logins (Google/Apple/Facebook) under **Authentication → Connections**
- Test the account settings page at `http://localhost:3100/<project-slug>/settings`
- Browse end-users + audit logs in the portal

## What's not wired

This sandbox **does not**:

- Create user records in the Restaurant Manager database. The test page just shows the claims; it doesn't link Authgear identities to local `User` rows. Migration would be a separate step.
- Touch the existing `phone-otp` / `email-password` providers. Riders, customers, admin, kitchen, and super-admin all still log in the way they do today.
- Affect the rider Bearer-JWT flow in the native app. That's `apps/web/src/server/rider-auth.ts`, completely independent.
- Run in production. `AUTHGEAR_ENABLED=true` is intentionally only in `.env.local` so a stray `git commit` can't accidentally turn it on in prod.

## If you decide to adopt Authgear for real

The migration would be roughly:

1. Pick a scope: replace one flow at a time. Most natural first target is super-admin login (small user count, MFA wanted there anyway).
2. Add a Prisma `authgearSub` column on `User` so you can link Authgear identities to existing accounts.
3. Run a one-time migration: for each existing super-admin, send them a "claim your Authgear account" email; they sign up in Authgear with the same email; the `signIn` callback in NextAuth links the new `sub` claim to the existing `User.id`.
4. Once linked, the existing email+password provider can be removed for that role.
5. Repeat for restaurant admin, kitchen, customer (in that order — customers are highest blast-radius).

I'd estimate ~3 days of focused work to migrate all roles, plus a 1-week soak period running both auths in parallel before you remove the legacy code.

## Tearing down

```bash
# Stop containers, keep data:
docker compose -f deploy/authgear/docker-compose.yml down

# Stop and WIPE everything (Postgres volume, projects, users):
docker compose -f deploy/authgear/docker-compose.yml down -v

# Disable the provider in the web app:
# Either delete the AUTHGEAR_* env vars from apps/web/.env.local, or set
# AUTHGEAR_ENABLED=false. The provider self-disables when ENABLED isn't true.
```

The only code change is the conditional provider in `apps/web/src/server/auth.ts` — that's safe to leave in place even when Authgear is off, it just becomes dead code.
