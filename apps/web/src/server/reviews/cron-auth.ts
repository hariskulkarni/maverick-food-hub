import { timingSafeEqual } from 'node:crypto';
import { auth } from '@/server/auth';

/** Constant-time check of x-internal-secret against INTERNAL_CRON_SECRET. */
export function internalSecretOk(header: string | null): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Job routes: internal cron secret OR a SUPER_ADMIN session. */
export async function jobAllowed(req: Request): Promise<boolean> {
  if (internalSecretOk(req.headers.get('x-internal-secret'))) return true;
  const session = await auth();
  return session?.user?.role === 'SUPER_ADMIN';
}
