/**
 * GET  /api/rider/payouts — withdrawable balance + payout history.
 * POST /api/rider/payouts — request an instant withdrawal.
 *
 * For the demo there's no real payment rail: a POST settles immediately via a
 * mock processor (status PAID, a MOCK-xxxxxx reference, processedAt = now).
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { computeAvailableBalance } from '@/server/rider-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mockReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `MOCK-${out}`;
}

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
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

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

  const available = await computeAvailableBalance(profile.id);
  // Round to paise to dodge floating-point edge cases on the boundary.
  if (Math.round(amount * 100) > Math.round(available * 100)) {
    return Response.json(
      { error: `You can withdraw up to ₹${available.toFixed(2)} right now.` },
      { status: 400 }
    );
  }

  const now = new Date();
  const payout = await prisma.riderPayout.create({
    data: {
      riderId: profile.id,
      amount,
      method,
      upiId,
      status: 'PAID', // demo: mock processor settles instantly
      reference: mockReference(),
      processedAt: now,
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
