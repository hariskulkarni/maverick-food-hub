/**
 * Platform-level security: TOTP 2FA, IP allowlist, and lockout settings for
 * the SUPER_ADMIN login flow.
 *
 * Storage trick:
 *   We piggy-back on the existing `IntegrationCredential` table (which already
 *   has AES-256-GCM at-rest encryption via `encryptJSON` / `decryptJSON`)
 *   under a synthetic provider `PLATFORM_2FA`. The row is keyed on a sentinel
 *   restaurantId `__platform__` (lazily upserted so the FK is satisfied).
 *
 * Stored JSON shape (encrypted in `configEncrypted`):
 *   {
 *     totpSecret?:   string;   // base32, active (verified) secret
 *     totpPending?:  string;   // base32, pending secret awaiting first /verify
 *     allowlist?:    string[]; // raw IPs or CIDR strings, one per line
 *     lockoutMinutes?: number; // how long to lock an email after 5 failed attempts
 *   }
 *
 * Secrets MUST NEVER leak to the client beyond the initial setup flow.
 */

import { authenticator } from 'otplib';
import { prisma } from './db';
import { encryptJSON, decryptJSON } from './crypto';
import { IntegrationStatus, RestaurantStatus, type IntegrationProvider } from '@prisma/client';

// `PLATFORM_2FA` is declared in schema.prisma but the generated client may not
// be regenerated yet in some environments. Use a typed-cast constant so it
// works regardless and is single-source.
const PROVIDER_2FA = 'PLATFORM_2FA' as IntegrationProvider;

export const PLATFORM_RESTAURANT_ID = '__platform__';

export interface PlatformSecurity {
  totpSecret?: string;
  totpPending?: string;
  allowlist?: string[];
  lockoutMinutes?: number;
}

/** Make sure the sentinel Restaurant row exists so the FK on IntegrationCredential holds. */
async function ensurePlatformRestaurant(): Promise<void> {
  // Need a non-null ownerUserId. Find or fall back to first SUPER_ADMIN.
  const existing = await prisma.restaurant.findUnique({ where: { id: PLATFORM_RESTAURANT_ID } });
  if (existing) return;
  const owner = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!owner) throw new Error('Cannot bootstrap platform security: no SUPER_ADMIN user exists.');
  await prisma.restaurant.upsert({
    where: { id: PLATFORM_RESTAURANT_ID },
    update: {},
    create: {
      id: PLATFORM_RESTAURANT_ID,
      slug: '__platform__',
      name: 'Platform (internal)',
      ownerUserId: owner.id,
      status: RestaurantStatus.SUSPENDED // never serves orders
    }
  });
}

export async function getPlatformSecurity(): Promise<PlatformSecurity> {
  const row = await prisma.integrationCredential.findUnique({
    where: {
      restaurantId_provider: {
        restaurantId: PLATFORM_RESTAURANT_ID,
        provider: PROVIDER_2FA
      }
    }
  });
  if (!row) return {};
  try {
    return decryptJSON<PlatformSecurity>(row.configEncrypted);
  } catch {
    return {};
  }
}

export async function setPlatformSecurity(input: PlatformSecurity): Promise<void> {
  await ensurePlatformRestaurant();
  const current = await getPlatformSecurity();
  const merged: PlatformSecurity = { ...current, ...input };
  // Strip undefined keys so they don't get persisted as `undefined`.
  (Object.keys(merged) as (keyof PlatformSecurity)[]).forEach((k) => {
    if (merged[k] === undefined) delete merged[k];
  });
  const enc = encryptJSON(merged);
  await prisma.integrationCredential.upsert({
    where: {
      restaurantId_provider: {
        restaurantId: PLATFORM_RESTAURANT_ID,
        provider: PROVIDER_2FA
      }
    },
    update: {
      configEncrypted: enc,
      status: merged.totpSecret ? IntegrationStatus.CONNECTED : IntegrationStatus.DISCONNECTED,
      summary: {
        totpEnabled: Boolean(merged.totpSecret),
        allowlistCount: merged.allowlist?.length ?? 0,
        lockoutMinutes: merged.lockoutMinutes ?? null
      }
    },
    create: {
      restaurantId: PLATFORM_RESTAURANT_ID,
      provider: PROVIDER_2FA,
      configEncrypted: enc,
      status: merged.totpSecret ? IntegrationStatus.CONNECTED : IntegrationStatus.DISCONNECTED,
      summary: {
        totpEnabled: Boolean(merged.totpSecret),
        allowlistCount: merged.allowlist?.length ?? 0,
        lockoutMinutes: merged.lockoutMinutes ?? null
      }
    }
  });
}

export function verifyTotp(secret: string, token: string): boolean {
  if (!secret || !token) return false;
  try {
    return authenticator.check(token.trim(), secret);
  } catch {
    return false;
  }
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUrl(secret: string, account: string, issuer = 'Restaurant Manager'): string {
  return authenticator.keyuri(account, issuer, secret);
}

// ─────────────────────────────────────────────────────────────────────────────
//  IP allowlist matching (supports plain IPv4 + CIDR like 10.0.0.0/8)
// ─────────────────────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

export function ipMatchesAllowlist(ip: string, allowlist: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true; // empty list = no restriction
  const cleanIp = ip.split(',')[0]!.trim().replace(/^::ffff:/, '');
  const ipNum = ipv4ToInt(cleanIp);
  for (const raw of allowlist) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!entry.includes('/')) {
      if (entry === cleanIp) return true;
      continue;
    }
    const [base, maskStr] = entry.split('/');
    const mask = Number(maskStr);
    if (!Number.isInteger(mask) || mask < 0 || mask > 32 || ipNum === null) continue;
    const baseNum = ipv4ToInt(base!);
    if (baseNum === null) continue;
    const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    if ((ipNum & maskBits) === (baseNum & maskBits)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  In-memory login-attempt tracker (per-process; reset on deploy — acceptable
//  for super-admin login since the cohort is tiny).
// ─────────────────────────────────────────────────────────────────────────────

interface AttemptRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptRecord>();
const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 5;

export function isLockedOut(email: string): boolean {
  const rec = attempts.get(email);
  if (!rec?.lockedUntil) return false;
  if (Date.now() < rec.lockedUntil) return true;
  attempts.delete(email);
  return false;
}

export function recordLoginFailure(email: string, lockoutMinutes: number): void {
  const now = Date.now();
  const rec = attempts.get(email);
  if (!rec || now - rec.firstFailureAt > FAILURE_WINDOW_MS) {
    attempts.set(email, { failures: 1, firstFailureAt: now });
    return;
  }
  rec.failures += 1;
  if (rec.failures >= MAX_FAILURES) {
    rec.lockedUntil = now + Math.max(1, lockoutMinutes) * 60_000;
  }
  attempts.set(email, rec);
}

export function recordLoginSuccess(email: string): void {
  attempts.delete(email);
}
