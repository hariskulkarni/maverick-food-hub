/**
 * POST /api/rider/profile/preview-verify
 *
 * Live, *non-persisting* verification call. Used by the upload dialog to give
 * the rider real-time confidence ("✓ Looks valid (Karza)") while they type a
 * PAN or DL number — BEFORE they commit to uploading a file.
 *
 * Tenancy: rider-only. We don't even pass through the rider id; this is a
 * pure "ping the verifier" proxy. No RiderKycDocument row is written. The
 * client is responsible for debouncing (≥600ms) to avoid hammering the vendor
 * while the rider types.
 *
 * Body: { type: 'PAN_CARD' | 'DRIVING_LICENSE', rawNumber, dateOfBirth? }
 *
 * Returns the raw VerifyOutcome shape (with provider). The client maps that
 * to "Verifying…", "Looks valid", "Not found in records", or a soft warning
 * when the vendor itself is down (status: 'ERROR').
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { runLiveVerification } from '@/server/kyc-verifiers';
import { validateForType } from '@/server/kyc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BODY = z.object({
  type: z.enum(['PAN_CARD', 'DRIVING_LICENSE']),
  rawNumber: z.string().trim().min(1).max(40),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response('Expected JSON body', { status: 400 });
  }
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { type, rawNumber, dateOfBirth } = parsed.data;

  // Re-run the canonical server validator so we don't waste a vendor call on
  // a malformed number (and the outcome shape matches what the upload path
  // would have done anyway).
  const v = validateForType(type, rawNumber);
  if (!v.ok) {
    return Response.json({
      status: 'FAIL',
      reason: v.error,
      provider: 'format-check',
    });
  }

  const outcome = await runLiveVerification({
    type,
    rawNumber: v.normalized,
    dateOfBirth,
  });

  return Response.json(outcome);
}
