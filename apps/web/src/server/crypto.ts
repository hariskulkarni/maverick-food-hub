/**
 * AES-256-GCM helpers for integration secrets.
 *
 * Key resolution:
 *   1. INTEGRATION_ENCRYPTION_KEY (32 bytes, base64)  — preferred
 *   2. NEXTAUTH_SECRET (any length, HKDF-derived)     — dev fallback
 *
 * Ciphertext format: base64( iv(12) ‖ authTag(16) ‖ ciphertext )
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

function resolveKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (raw) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes (base64-encoded).');
  }
  const seed = process.env.NEXTAUTH_SECRET;
  if (!seed) {
    throw new Error(
      'No encryption key available. Set INTEGRATION_ENCRYPTION_KEY (32-byte base64) or NEXTAUTH_SECRET.'
    );
  }
  // Deterministic dev key derived from NEXTAUTH_SECRET. NOT suitable for prod.
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
