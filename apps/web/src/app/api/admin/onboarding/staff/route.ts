/**
 * GET  /api/admin/onboarding/staff — the active restaurant's team (owner + staff).
 * POST /api/admin/onboarding/staff — the owner invites a team member:
 *        { name, email, role: KITCHEN | ADMIN, branchId? }
 *
 * Mirrors the super-admin staff route (src/app/api/platform/restaurants/[id]/staff)
 * but scoped to the caller's own restaurant: a new User + RestaurantUser (+ a
 * BranchUser for KITCHEN when a branch is chosen) in one transaction. The
 * temporary password is generated server-side and returned ONCE so the owner
 * can hand it over; it is never logged or audited. Staff roles enrol 2FA on
 * first sign-in (src/server/user-totp.ts). An email that already exists → 409;
 * we never attach an existing account.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { rateLimit } from '@/server/http/rate-limit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { generateTempPassword } from '@/server/restaurant-wizard';
import { onboardingAdminScope, auditMeta } from '@/server/onboarding-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;
  const members = await prisma.restaurantUser.findMany({
    where: { restaurantId: scope.restaurant.id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  });
  return Response.json({
    staff: members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      isOwner: m.user.id === scope.restaurant.ownerUserId,
      addedAt: m.createdAt.toISOString(),
    })),
  });
}

const Body = z.object({
  name: z.string().trim().min(2, 'Name needs at least 2 characters').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email, e.g. kitchen@spicegarden.in').max(160),
  role: z.enum(['KITCHEN', 'ADMIN']),
  branchId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;
  const rl = await rateLimit(req, { name: 'onboarding-staff', limit: 20, windowMs: 600_000, key: scope.restaurant.id });
  if (!rl.ok) return rl.response;

  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;

  if (parsed.branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: parsed.branchId, restaurantId: scope.restaurant.id }, select: { id: true } });
    if (!branch) return Response.json({ error: 'Branch not found.', reason: 'not_found' }, { status: 404 });
  }
  const existing = await prisma.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (existing) {
    return Response.json({ error: 'Someone already uses that email on Flavrly. Use a different email for this staff login.', reason: 'email_taken' }, { status: 409 });
  }

  const role = Role[parsed.role];
  const tempPassword = generateTempPassword(14);
  const passwordHash = await argon2.hash(tempPassword);

  let user: { id: string; email: string | null; name: string | null };
  try {
    user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email: parsed.email, name: parsed.name, passwordHash, role },
        select: { id: true, email: true, name: true },
      });
      await tx.restaurantUser.create({ data: { restaurantId: scope.restaurant.id, userId: u.id, role } });
      if (parsed.branchId && role === Role.KITCHEN) {
        await tx.branchUser.create({ data: { branchId: parsed.branchId, userId: u.id, role } });
      }
      return u;
    });
  } catch (e: any) {
    if (e?.code === 'P2002') return Response.json({ error: 'That email is already registered.', reason: 'email_taken' }, { status: 409 });
    throw e;
  }

  await audit('user.create', {
    actorId: scope.session.user.id,
    actorRole: scope.session.user.role,
    restaurantId: scope.restaurant.id,
    entityType: 'User',
    entityId: user.id,
    after: { email: user.email, role, via: 'onboarding', branchId: parsed.branchId ?? null },
    ...auditMeta(req),
  });

  return Response.json(
    { staff: { id: user.id, name: user.name, email: user.email, role }, tempPassword },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}
