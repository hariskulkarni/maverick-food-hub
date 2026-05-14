/**
 * Super-admin Signup Bonus singleton config.
 *
 *   GET — returns the singleton row, creating one with defaults if it doesn't
 *         exist yet so the editor always has something to render.
 *   PUT — upserts the singleton with a validated body. Audits with full
 *         before/after snapshots for dispute reconstruction.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireSuperAdmin } from '@/server/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({
  isActive:           z.boolean(),
  totalAmount:        z.number().positive(),
  splitCount:         z.number().int().min(1).max(20),
  perOrderCap:        z.number().positive().optional().nullable(),
  minOrderValue:      z.number().min(0).optional().nullable(),
  phoneCheckEnabled:  z.boolean(),
  ipCheckEnabled:     z.boolean(),
  deviceCheckEnabled: z.boolean(),
  validityDays:       z.number().int().min(0).max(730)
});

const DEFAULTS = {
  id: 'singleton',
  isActive: false,
  totalAmount: 100 as any,
  splitCount: 5,
  perOrderCap: null as any,
  minOrderValue: null as any,
  phoneCheckEnabled: true,
  ipCheckEnabled: true,
  deviceCheckEnabled: false,
  validityDays: 90
};

export async function GET() {
  await requireSuperAdmin();
  let cfg = await (prisma as any).signupBonusConfig.findUnique({ where: { id: 'singleton' } });
  if (!cfg) {
    cfg = await (prisma as any).signupBonusConfig.create({ data: DEFAULTS });
  }
  return Response.json(cfg);
}

export async function PUT(req: NextRequest) {
  const session = await requireSuperAdmin();
  const data = Body.parse(await req.json());

  const before = await (prisma as any).signupBonusConfig.findUnique({ where: { id: 'singleton' } });

  // Default perOrderCap = totalAmount / splitCount (rounded to 2dp) when absent.
  const computedCap = data.perOrderCap != null
    ? data.perOrderCap
    : Math.round((data.totalAmount / Math.max(1, data.splitCount)) * 100) / 100;

  const payload: any = {
    isActive:           data.isActive,
    totalAmount:        data.totalAmount as any,
    splitCount:         data.splitCount,
    perOrderCap:        computedCap as any,
    minOrderValue:      data.minOrderValue != null ? (data.minOrderValue as any) : null,
    phoneCheckEnabled:  data.phoneCheckEnabled,
    ipCheckEnabled:     data.ipCheckEnabled,
    deviceCheckEnabled: data.deviceCheckEnabled,
    validityDays:       data.validityDays,
    updatedById:        session.user.id
  };

  const after = await (prisma as any).signupBonusConfig.upsert({
    where:  { id: 'singleton' },
    create: { id: 'singleton', ...payload },
    update: payload
  });

  await audit('signup_bonus.config.update' as any, {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'SignupBonusConfig',
    entityId: 'singleton',
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after:  JSON.parse(JSON.stringify(after)),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(after);
}
