/**
 * GET  /api/rider/payouts — withdrawable balance + payout history.
 * POST /api/rider/payouts — request a withdrawal.
 *
 * C6: there is no payment rail. A withdrawal is RECORDED as REQUESTED and is
 * settled out-of-band — an admin marks it PAID (platform/payouts) after an
 * actual bank/UPI transfer. The route must NOT self-report PAID with a fake
 * reference: that told riders they had been paid when no money moved.
 * computeAvailableBalance holds every non-FAILED payout and nets COD cash the
 * rider still carries; the POST runs under a per-rider advisory lock so two
 * concurrent requests can't both pass the balance check (P1-6).
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { computeAvailableBalance } from '@/server/rider-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, totalEarnings: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const payouts = await prisma.riderPayout.findMany({
    where: { riderId: profile.id },
    orderBy: { requestedAt: 'desc' },
    select: {
      id: true,
      amount: true,
      status: true,
      method: true,
      upiId: true,
      reference: true,
      note: true,
      requestedAt: true,
      processedAt: true,
    },
  });

  const totalPaidOut = payouts
    .filter((p) => p.status === 'PAID')
    .reduce((s, p) => s + Number(p.amount), 0);

  return Response.json({
    availableBalance: await computeAvailableBalance(profile.id),
    lifetimeEarnings: Number(profile.totalEarnings),
    totalPaidOut: Math.round(totalPaidOut * 100) / 100,
    payouts: payouts.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      method: p.method,
      upiId: p.upiId,
      reference: p.reference,
      note: p.note,
      requestedAt: p.requestedAt.toISOString(),
      processedAt: p.processedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, user: { select: { isTestAccount: true } } },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });
  // Pre-launch test riders (server/test-accounts.ts) only carry test orders;
  // their earnings are not real money and can never be withdrawn.
  if (profile.user.isTestAccount) {
    return Response.json(
      { error: 'Test rider accounts cannot request payouts.', code: 'test_account' },
      { status: 403 },
    );
  }

  let body: { amount?: unknown; method?: unknown; upiId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'Enter a withdrawal amount greater than ₹0.' }, { status: 400 });
  }

  const method = body.method === 'BANK' ? 'BANK' : 'UPI';
  const upiId =
    typeof body.upiId === 'string' && body.upiId.trim() ? body.upiId.trim() : null;
  if (method === 'UPI' && !upiId) {
    return Response.json({ error: 'A UPI ID is required for UPI withdrawals.' }, { status: 400 });
  }

  // P1-6: balance check + insert are one serialised unit per rider. The
  // transaction-scoped advisory lock makes concurrent withdrawals queue behind
  // each other, so the second one sees the first one's REQUESTED row.
  const amountPaise = Math.round(amount * 100);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rider-payout:' + profile.id}))`;
    const available = await computeAvailableBalance(profile.id, tx);
    // Compare in paise to dodge floating-point edge cases on the boundary.
    if (amountPaise > Math.round(available * 100)) return { ok: false as const, available };
    const payout = await tx.riderPayout.create({
      data: {
        riderId: profile.id,
        amount: amountPaise / 100,
        method,
        upiId,
        // C6: recorded as a request; an admin settles it out-of-band and marks it
        // PAID after a real transfer. No fabricated reference, no processedAt.
        status: 'REQUESTED',
      },
      select: {
        id: true,
        amount: true,
        status: true,
        method: true,
        upiId: true,
        reference: true,
        note: true,
        requestedAt: true,
        processedAt: true,
      },
    });
    return { ok: true as const, payout };
  });
  if (!result.ok) {
    return Response.json(
      { error: `You can withdraw up to ₹${result.available.toFixed(2)} right now.` },
      { status: 400 }
    );
  }
  const payout = result.payout;

  return Response.json({
    payout: {
      id: payout.id,
      amount: Number(payout.amount),
      status: payout.status,
      method: payout.method,
      upiId: payout.upiId,
      reference: payout.reference,
      note: payout.note,
      requestedAt: payout.requestedAt.toISOString(),
      processedAt: payout.processedAt?.toISOString() ?? null,
    },
  });
}
