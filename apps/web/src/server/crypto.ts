/**
 * AES-256-GCM helpers for integration secrets.
 *
 * Key resolution:
 *   - PRODUCTION: INTEGRATION_ENCRYPTION_KEY (32 bytes, base64) is REQUIRED.
 *     There is intentionally NO fallback in production — deriving a key from
 *     NEXTAUTH_SECRET would couple secret-at-rest encryption to the session
 *     secret (rotating one silently breaks the other) and is weaker than a
 *     dedicated random key. Missing/invalid key → hard fail at first use.
 *   - DEV/TEST only: if INTEGRATION_ENCRYPTION_KEY is absent we derive a
 *     deterministic key from NEXTAUTH_SECRET so local dev/CI boots without
 *     extra setup. This path is unreachable in production.
 *
 * Ciphertext format: base64( iv(12) ‖ authTag(16) ‖ ciphertext )
 *
 * Generate a production key with:  openssl rand -base64 32
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const IS_PROD = process.env.NODE_ENV === 'production';

function resolveKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (raw) {
    let buf: Buffer;
    try {
      buf = Buffer.from(raw, 'base64');
    } catch {
      throw new Error('INTEGRATION_ENCRYPTION_KEY is not valid base64. Generate one with: openssl rand -base64 32');
    }
    if (buf.length !== 32) {
      throw new Error(
        `INTEGRATION_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${buf.length}). Generate one with: openssl rand -base64 32`
      );
    }
    return buf;
  }

  // No dedicated key set.
  if (IS_PROD) {
    // Hard fail — never silently fall back to NEXTAUTH_SECRET in production.
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY is required in production and is missing. ' +
        'Set a 32-byte base64 key (openssl rand -base64 32) in the environment. ' +
        'Refusing to derive an encryption key from NEXTAUTH_SECRET in production.'
    );
  }

  const seed = process.env.NEXTAUTH_SECRET;
  if (!seed) {
    throw new Error(
      'No encryption key available. Set INTEGRATION_ENCRYPTION_KEY (32-byte base64) or NEXTAUTH_SECRET (dev only).'
    );
  }
  // Deterministic DEV-ONLY key derived from NEXTAUTH_SECRET. Unreachable in prod.
  return createHash('sha256').update(`integration-v1:${seed}`).digest();
}

export function encryptJSON(plain: unknown): string {
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.from(JSON.stringify(plain), 'utf8');
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptJSON<T = unknown>(blob: string): T {
  const key = resolveKey();
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('ciphertext too short');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(dec.toString('utf8')) as T;
}

/** Mask: show last `tail` chars (default 4) and replace the rest with bullets. */
export function maskSecret(s: string | undefined | null, tail = 4): string {
  if (!s) return '';
  if (s.length <= tail) return '•'.repeat(s.length);
  return '•'.repeat(Math.max(4, s.length - tail)) + s.slice(-tail);
}
