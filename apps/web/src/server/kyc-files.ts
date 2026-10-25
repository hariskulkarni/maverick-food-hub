/**
 * KYC document files (P1-14): stored privately (storage().putPrivate) and served
 * only through GET /api/rider/kyc/[id]/file, which accepts either
 *   - an authenticated owner rider / SUPER_ADMIN session, or
 *   - a short-lived HMAC signature (`?exp=&sig=`) minted by `signedKycFileUrl`
 *     — so <img>/<iframe>/Linking (no auth headers) still work for the rider
 *     app and the platform review queue.
 *
 * Legacy rows uploaded before this change point at `/uploads/rider-kyc/...`
 * under public/. They stay readable through the same route (read from disk);
 * nginx now refuses that path directly (deploy/nginx.conf) and
 * `scripts/migrate-kyc-private.ts` moves them into private storage.
 */
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isPrivateRef, storage } from './storage';

export const KYC_FILE_URL_TTL_SECONDS = 15 * 60;

function key(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is required to sign KYC file links');
  return crypto.createHmac('sha256', s).update('flavrly:kyc-file:v1').digest('hex');
}

function sign(docId: string, exp: number): string {
  return crypto.createHmac('sha256', key()).update(`${docId}.${exp}`).digest('base64url');
}

/** Relative, signed, short-lived URL for a KYC document's file. */
export function signedKycFileUrl(docId: string, now: number = Date.now()): string {
  const exp = Math.floor(now / 1000) + KYC_FILE_URL_TTL_SECONDS;
  return `/api/rider/kyc/${encodeURIComponent(docId)}/file?exp=${exp}&sig=${sign(docId, exp)}`;
}

export function verifyKycFileSig(docId: string, expRaw: string | null, sig: string | null, now: number = Date.now()): boolean {
  if (!expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;
  const expected = sign(docId, exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Read the bytes behind a stored KYC fileUrl (private ref or legacy public path). */
export async function readKycFile(fileUrl: string): Promise<Buffer | null> {
  if (isPrivateRef(fileUrl)) return storage().getPrivate(fileUrl);
  if (fileUrl.startsWith('/uploads/rider-kyc/') && !fileUrl.includes('..')) {
    return fs.readFile(path.join(process.cwd(), 'public', fileUrl)).catch(() => null);
  }
  return null;
}
