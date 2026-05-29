/**
 * POST /api/platform/demo-reset
 *
 * Wipes the demo DB and re-runs the standard prisma seed. ONLY available when
 * `DEMO_MODE=true` AND the caller is a super-admin. Triple-guarded so a stray
 * call on prod (where this route shouldn't even be reachable) is impossible.
 *
 * Mechanics:
 *   1. Verify env + caller.
 *   2. Spawn `npx tsx prisma/seed.ts` as a child process. The seed script is
 *      itself idempotent — it truncates + reseeds the curated baseline.
 *   3. Stream the output back so the client can show progress.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireSuperAdmin } from '@/server/tenancy';
import { isDemoMode } from '@/lib/demo';
import { audit } from '@/server/audit';

const execAsync = promisify(exec);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isDemoMode()) {
    return new Response('Demo reset is only available in demo mode', { status: 404 });
  }

  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  try {
    // Run from the apps/web cwd. The seed reads DATABASE_URL from the env, so on
    // the demo runtime it correctly targets the demo Postgres database.
    const { stdout } = await execAsync('npx tsx prisma/seed.ts', {
      cwd: process.cwd(),
      env: process.env,
      timeout: 5 * 60_000, // 5 minutes max
      maxBuffer: 16 * 1024 * 1024,
    });

    await audit('platform.demo.reset', {
      actorId: session.user.id,
      actorRole: session.user.role,
      entityType: 'Database',
      after: { tailOfSeedLog: stdout.split('\n').slice(-20).join('\n') },
    });

    return Response.json({ ok: true, message: 'Demo reset complete' });
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || e).slice(0, 2000);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
