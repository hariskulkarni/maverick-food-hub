/**
 * GET  /api/rider/referrals — the rider's referral code, their referral
 *      history, and total bonus earned.
 * POST /api/rider/referrals — log a new referral (PENDING) against the rider's
 *      code.
 *
 * The referral *code* is derived deterministically from the rider's profile id
 * via `genReferralCode` — stable, so we never need a row just to hold it.
 * RiderReferral rows track individual referees and their reward status.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { genReferralCode } from '@/server/rider-growth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Flat demo bonus per qualified referral. */
const REFERRAL_BONUS = 500;

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const code = genReferralCode(profile.id);

  const referrals = await prisma.riderReferral.findMany({
    where: { referrerId: profile.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      refereePhone: true,
      refereeName: true,
      status: true,
      bonusAmount: true,
      createdAt: true,
      qualifiedAt: true,
      rewardedAt: true,
    },
  });

  const totalEarned = referrals
    .filter((r) => r.status === 'REWARDED')
    .reduce((sum, r) => sum + Number(r.bonusAmount), 0);

  return Response.json({
    code,
    totalEarned,
    referrals: referrals.map((r) => ({
      id: r.id,
      refereePhone: r.refereePhone,
      refereeName: r.refereeName,
      status: r.status,
      bonusAmount: Number(r.bonusAmount),
      createdAt: r.createdAt.toISOString(),
      qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
      rewardedAt: r.rewardedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  let body: { refereePhone?: unknown; refereeName?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const refereePhone =
    typeof body.refereePhone === 'string' ? body.refereePhone.trim() : '';
  const refereeName =
    typeof body.refereeName === 'string' ? body.refereeName.trim() : '';

  // Validate the phone defensively — a 10-digit Indian mobile, optionally with
  // a +91 / 0 prefix that we strip down to the bare 10 digits.
  const digits = refereePhone.replace(/\D/g, '');
  const normalized =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  if (normalized.length !== 10) {
    return Response.json(
      { error: 'Enter a valid 10-digit mobile number' },
      { status: 400 }
    );
  }

  const code = genReferralCode(profile.id);

  const referral = await prisma.riderReferral.create({
    data: {
      referrerId: profile.id,
      code,
      refereePhone: normalized,
      refereeName: refereeName || null,
      status: 'PENDING',
      bonusAmount: REFERRAL_BONUS,
    },
    select: {
      id: true,
      refereePhone: true,
      refereeName: true,
      status: true,
      bonusAmount: true,
      createdAt: true,
    },
  });

  return Response.json(
    {
      id: referral.id,
      refereePhone: referral.refereePhone,
      refereeName: referral.refereeName,
      status: referral.status,
      bonusAmount: Number(referral.bonusAmount),
      createdAt: referral.createdAt.toISOString(),
      qualifiedAt: null,
      rewardedAt: null,
    },
    { status: 201 }
  );
}
