import { auth } from '@/server/auth';
import { secretMatches } from '@/server/http/secret-compare';

/** Constant-time check of x-internal-secret against INTERNAL_CRON_SECRET. */
export function internalSecretOk(header: string | null): boolean {
  return secretMatches(header, process.env.INTERNAL_CRON_SECRET);
}

/** Job routes: internal cron secret OR a SUPER_ADMIN session. */
export async function jobAllowed(req: Request): Promise<boolean> {
  if (internalSecretOk(req.headers.get('x-internal-secret'))) return true;
  const session = await auth();
  return session?.user?.role === 'SUPER_ADMIN';
}
