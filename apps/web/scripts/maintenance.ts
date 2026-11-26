/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Maintenance mode CLI — the ONLY way to open or close the platform
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   npm run maintenance:status
 *   npm run maintenance:on  -- --message "Back by 2am IST" --url https://flavrly.in
 *   npm run maintenance:off
 *
 * Run it on the server, from apps/web, with the production env loaded (the
 * deploy checkout already has apps/web/.env, which `tsx` picks up via Next's
 * loader — see the dotenv call below).
 *
 * There is no product UI for this on purpose. The switch exists to hold the
 * door shut during a migration or an incident; a control a signed-in admin
 * could flip is a control anyone with an admin session could flip, which is
 * the exact situation it's there to contain.
 *
 * Turning it ON prints a one-time BYPASS URL. Open that once in your browser
 * and you can keep using the real site while everyone else sees the holding
 * page — necessary to verify a fix before reopening. The link is HMAC-signed
 * with the session secret, carries its own expiry (12h by default) and cannot
 * be extended; the cookie it sets dies with it.
 *
 * Exit codes: 0 success, 1 usage/plumbing error. Safe to re-run.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Load apps/web/.env, where the deploy keeps production config (see
 * docs/PRODUCTION-DEPLOY.md). Hand-rolled rather than pulling in `dotenv`:
 * this package doesn't depend on it, and a one-command ops script shouldn't
 * add a dependency to production's install. Already-exported variables win,
 * so `DATABASE_URL=... npm run maintenance:status` still overrides the file.
 */
function loadDotEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadDotEnv();

import { getMaintenance, setMaintenance, MAX_MAINTENANCE_MESSAGE } from '../src/server/maintenance';
import { signToken } from '../src/server/signed-token';
import {
  MAINTENANCE_BYPASS_SCOPE,
  MAINTENANCE_BYPASS_TTL_SECONDS,
  MAINTENANCE_BYPASS_PATH,
} from '../src/server/maintenance-paths';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

function usage(): never {
  console.log(`
${BOLD}Flavrly maintenance mode${OFF}

  npm run maintenance:status
  npm run maintenance:on   [-- --message "..."] [--url https://flavrly.in] [--hours 12]
  npm run maintenance:off

${BOLD}Options${OFF}
  --message   Shown on the holding page (max ${MAX_MAINTENANCE_MESSAGE} chars).
  --url       Base URL used to build the bypass link. Defaults to
              NEXT_PUBLIC_SITE_URL, else https://flavrly.in.
  --hours     Bypass link lifetime in hours (default ${MAINTENANCE_BYPASS_TTL_SECONDS / 3600}, max 72).
  --by        Operator label for the audit trail. Defaults to user@host.
`);
  process.exit(1);
}

/** Minimal flag parsing — no dependency, and the surface is three commands. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function defaultBy(): string {
  const user = process.env.SUDO_USER || process.env.USER || process.env.LOGNAME || 'unknown';
  const host = process.env.HOSTNAME || 'server';
  return `cli:${user}@${host}`;
}

function baseUrl(): string {
  const raw = arg('url') || process.env.NEXT_PUBLIC_SITE_URL || 'https://flavrly.in';
  return raw.replace(/\/+$/, '');
}

/**
 * Both surfaces. The bypass cookie is host-only (no Domain attribute), so one
 * claim does NOT cover both hostnames — the link has to be opened on each.
 * Printing both is the difference between "the bypass is broken" and "oh, I
 * need to click the second one too".
 */
function surfaceUrls(): { label: string; base: string }[] {
  const site = baseUrl();
  const portalRaw = process.env.NEXT_PUBLIC_PORTAL_URL || site.replace(/^(https?:\/\/)(?:www\.)?/, '$1portal.');
  const portal = portalRaw.replace(/\/+$/, '');
  const out = [{ label: 'customer site', base: site }];
  if (portal && portal !== site) out.push({ label: 'staff portal ', base: portal });
  return out;
}

function describe(state: Awaited<ReturnType<typeof getMaintenance>>): void {
  if (!state.on) {
    console.log(`\n  ${GREEN}● OPEN${OFF} — the platform is serving normally.\n`);
    return;
  }
  console.log(`\n  ${RED}● CLOSED${OFF} — every visitor sees the holding page (staff and super admins too).`);
  if (state.since) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(state.since).getTime()) / 60000));
    console.log(`  ${DIM}since${OFF}   ${state.since}  (${mins} min ago)`);
  }
  if (state.message) console.log(`  ${DIM}message${OFF} ${state.message}`);
  if (state.by) console.log(`  ${DIM}by${OFF}      ${state.by}`);
  console.log('');
}

async function mintBypass(): Promise<{ hours: number; links: { label: string; url: string }[] }> {
  const hours = Math.min(72, Math.max(0.25, Number(arg('hours')) || MAINTENANCE_BYPASS_TTL_SECONDS / 3600));
  // One token, claimed per hostname — the cookie it sets is host-only.
  const token = await signToken({ scope: MAINTENANCE_BYPASS_SCOPE }, Math.round(hours * 3600));
  const links = surfaceUrls().map(({ label, base }) => {
    const url = new URL(MAINTENANCE_BYPASS_PATH, `${base}/`);
    url.searchParams.set('t', token);
    url.searchParams.set('next', '/');
    return { label, url: url.toString() };
  });
  return { hours, links };
}

async function main(): Promise<void> {
  const cmd = (process.argv[2] || '').toLowerCase();

  if (cmd === 'status' || cmd === '') {
    describe(await getMaintenance());
    return;
  }

  if (cmd === 'on') {
    const state = await setMaintenance(true, { message: arg('message'), by: arg('by') || defaultBy() });
    describe(state);

    let bypass: Awaited<ReturnType<typeof mintBypass>> | null = null;
    try {
      bypass = await mintBypass();
    } catch (e) {
      console.log(`  ${YELLOW}! Could not mint a bypass link:${OFF} ${(e as Error).message}`);
      console.log(`    ${DIM}Set NEXTAUTH_SECRET in apps/web/.env and re-run maintenance:status.${OFF}\n`);
    }

    if (bypass) {
      console.log(
        `  ${BOLD}Your bypass links${OFF} ${DIM}(valid ${bypass.hours}h — open EACH ONE once, in the browser you'll test from)${OFF}`,
      );
      for (const l of bypass.links) console.log(`  ${DIM}${l.label}${OFF}  ${l.url}`);
      console.log('');
      console.log(
        `  ${DIM}The cookie is host-only, so the portal needs its own claim.\n` +
          `  Clear it again with <host>${MAINTENANCE_BYPASS_PATH}?clear=1${OFF}`,
      );
    }
    console.log(
      `  ${DIM}Takes effect within ~10s (middleware caches the flag). Payment webhooks and\n` +
        `  health probes keep working on purpose — see docs/MAINTENANCE-MODE.md.${OFF}\n`,
    );
    return;
  }

  if (cmd === 'off') {
    describe(await setMaintenance(false));
    console.log(`  ${DIM}Live within ~10s. Any outstanding bypass cookies are now irrelevant.${OFF}\n`);
    return;
  }

  if (cmd === 'bypass') {
    const b = await mintBypass();
    console.log('');
    for (const l of b.links) console.log(`  ${DIM}${l.label}${OFF}  ${l.url}`);
    console.log('');
    return;
  }

  usage();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${RED}✗ ${(e as Error).message}${OFF}\n`);
    process.exit(1);
  });
