/**
 * Platform → System health → "Safe cleanup".
 *
 *   GET  /api/platform/system/cleanup   → preview reclaimable cache/log space
 *   POST /api/platform/system/cleanup   → reclaim it (super-admin only, audited)
 *
 * Delegates to src/server/system-cleanup.ts, which only ever touches a fixed
 * allowlist of cache/log paths — never uploads, the database, or .env. See that
 * file's header for the full safety model.
 */
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { log } from '@/server/log';
import { previewCleanup, runSafeCleanup } from '@/server/system-cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const report = await previewCleanup();
  return Response.json(report, { headers: NO_STORE });
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const report = await runSafeCleanup();

  await audit('platform.cache.cleanup', {
    actorId: session.user?.id,
    actorRole: session.user?.role,
    entityType: 'System',
    after: {
      totalBytesFreed: report.totalBytes,
      targets: report.targets.map((t) => ({ key: t.key, bytes: t.bytes, cleared: t.cleared, note: t.note })),
      diskBefore: report.diskBefore,
      diskAfter: report.diskAfter,
    },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined,
  }).catch((err) => log.error({ err }, 'audit platform.cache.cleanup failed'));

  return Response.json(report, { headers: NO_STORE });
}
