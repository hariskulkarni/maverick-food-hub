import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { imageRef, optionalString } from '@/server/zod-helpers';

// ─── GET ────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;

  const brand = await (prisma as any).brand.findUnique({
    where: { id },
    include: {
      restaurants: {
        orderBy: { name: 'asc' },
        include: { _count: { select: { branches: true } } }
      }
    }
  });
  if (!brand) return new Response('Not found', { status: 404 });

  return Response.json({
    brand: {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      tagline: brand.tagline,
      description: brand.description,
      logoUrl: brand.logoUrl,
      coverImageUrl: brand.coverImageUrl,
      contactEmail: brand.contactEmail,
      contactPhone: brand.contactPhone,
      ownerUserId: brand.ownerUserId,
      status: brand.status,
      createdAt: brand.createdAt,
      updatedAt: brand.updatedAt
    },
    restaurants: brand.restaurants.map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      cuisine: r.cuisine,
      branchCount: r._count.branches
    }))
  });
}

// ─── PATCH ──────────────────────────────────────────────────────────────────
const PatchBody = z.object({
  name:          optionalString(200),
  tagline:       z.string().nullable().optional(),
  description:   z.string().nullable().optional(),
  logoUrl:       imageRef.optional().nullable(),
  coverImageUrl: imageRef.optional().nullable(),
  contactEmail:  z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  contactPhone:  z.string().nullable().optional(),
  ownerUserId:   z.string().nullable().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  const before = await (prisma as any).brand.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  const after = await (prisma as any).brand.update({ where: { id }, data });

  await audit('brand.update', {
    actorId:   session?.user?.id,
    actorRole: session?.user?.role,
    entityId:  id,
    before: {
      name: before.name, tagline: before.tagline, description: before.description,
      logoUrl: before.logoUrl, coverImageUrl: before.coverImageUrl,
      contactEmail: before.contactEmail, contactPhone: before.contactPhone,
      ownerUserId: before.ownerUserId
    },
    after: {
      name: after.name, tagline: after.tagline, description: after.description,
      logoUrl: after.logoUrl, coverImageUrl: after.coverImageUrl,
      contactEmail: after.contactEmail, contactPhone: after.contactPhone,
      ownerUserId: after.ownerUserId
    },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent')
  });

  return Response.json(after);
}

// ─── DELETE (soft) ──────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;

  const before = await (prisma as any).brand.findUnique({ where: { id }, select: { status: true } });
  if (!before) return new Response('Not found', { status: 404 });

  const after = await (prisma as any).brand.update({ where: { id }, data: { status: 'SUSPENDED' } });

  await audit('brand.deactivate', {
    actorId:   session?.user?.id,
    actorRole: session?.user?.role,
    entityId:  id,
    before:    { status: before.status },
    after:     { status: after.status },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent')
  });

  return Response.json({ ok: true });
}
