/**
 * PATCH /api/admin/onboarding/legal — restaurant-level tax identity
 * (legal name, GSTIN, PAN). These columns already exist on Restaurant and feed
 * the settlement report, but had no restaurant-side editor. FSSAI is per
 * premises and is saved through the existing branch settings route.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { onboardingAdminScope, auditMeta } from '@/server/onboarding-auth';
import { validateGstin, validateGstinMatchesPan, validatePan } from '@/lib/onboarding/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const upperOrNull = z.string().max(20).transform((v) => v.replace(/\s+/g, '').toUpperCase() || null).nullable().optional();

const Body = z
  .object({
    legalName: z.string().max(160).transform((v) => v.trim() || null).nullable().optional(),
    gstin: upperOrNull,
    pan: upperOrNull,
  })
  .superRefine((v, ctx) => {
    const g = validateGstin(v.gstin);
    if (g) ctx.addIssue({ code: 'custom', path: ['gstin'], message: g });
    const p = validatePan(v.pan);
    if (p) ctx.addIssue({ code: 'custom', path: ['pan'], message: p });
    const m = validateGstinMatchesPan(v.gstin, v.pan);
    if (m) ctx.addIssue({ code: 'custom', path: ['pan'], message: m });
  });

export async function PATCH(req: NextRequest) {
  const scope = await onboardingAdminScope();
  if (scope instanceof Response) return scope;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;

  const before = { legalName: scope.restaurant.legalName, gstin: scope.restaurant.gstin, pan: scope.restaurant.pan };
  const updated = await prisma.restaurant.update({
    where: { id: scope.restaurant.id },
    data: {
      ...(parsed.legalName !== undefined && { legalName: parsed.legalName }),
      ...(parsed.gstin !== undefined && { gstin: parsed.gstin }),
      ...(parsed.pan !== undefined && { pan: parsed.pan }),
    },
    select: { legalName: true, gstin: true, pan: true },
  });
  await audit('restaurant.settings.update', {
    actorId: scope.session.user.id,
    actorRole: scope.session.user.role,
    restaurantId: scope.restaurant.id,
    entityType: 'Restaurant',
    entityId: scope.restaurant.id,
    before,
    after: { legal: updated },
    ...auditMeta(req),
  });
  return Response.json({ legal: updated });
}
