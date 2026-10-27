/**
 * POST /api/rider/integrity — device attestation (Google Play Integrity).
 *
 * The rider app requests a Play Integrity token at sign-in / shift start and
 * posts it here. The server decodes it against Google's Play Integrity API and
 * stores only the device/app *verdict* (MEETS_DEVICE_INTEGRITY, …) — never
 * personal data, never a list of installed apps. A FAILED verdict flags the
 * rider for ops review (and, behind a default-off setting, can gate going
 * online — enforced by /api/rider/online).
 *
 * Degrades cleanly: when Play Integrity isn't configured the response reports
 * `configured: false` / verdict UNEVALUATED and nothing is blocked.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { parseOrJsonError } from '@/server/zod-helpers';
import { isPlayIntegrityConfigured, verifyIntegrityToken } from '@/server/rider-integrity/play-integrity';
import { applyIntegrityVerdict } from '@/server/rider-integrity/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ token: z.string().min(1).max(8192) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  // Not configured → nothing to verify; report cleanly so the app knows.
  if (!isPlayIntegrityConfigured()) {
    return Response.json({ configured: false, verdict: 'UNEVALUATED' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parseOrJsonError(Body, raw);
  if (parsed instanceof Response) return parsed;

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const result = await verifyIntegrityToken(parsed.token);
  const verdict = await applyIntegrityVerdict(profile.id, result);

  return Response.json(
    { configured: result.configured, verdict },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
