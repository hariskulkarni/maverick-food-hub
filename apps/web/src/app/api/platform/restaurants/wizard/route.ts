/**
 * Super-admin "create restaurant" wizard — single transactional endpoint.
 *
 * The wizard collects every piece of state the platform needs to spin up a new
 * tenant in one shot (identity, brand assignment, first branch, staff
 * accounts, optional starter riders, optional seeded starter menu). We commit
 * it all inside one `prisma.$transaction` so a partially-broken restaurant is
 * never left behind on validation/uniqueness errors.
 *
 * Returns the freshly-created Restaurant id + slug + the temp credentials for
 * the new admin and kitchen users so the wizard can present them to the
 * super-admin (who will hand them off to the restaurant onboard contact).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { log } from '@/server/log';
import { slugifyName } from '@/server/brands';
import {
  RESERVED_RESTAURANT_SLUGS,
  normaliseRestaurantSlug,
  isValidLatLng
} from '@/server/restaurant-wizard';

// ── Zod schema ──────────────────────────────────────────────────────────────

const NonEmptyString = z.string().min(1).max(200);
const OptionalString = z.string().max(500).optional().nullable().or(z.literal('').transform(() => null));
const OptionalUrl = z.string().url().optional().nullable().or(z.literal('').transform(() => null));
const OptionalEmail = z.string().email().optional().nullable().or(z.literal('').transform(() => null));

const IdentitySchema = z.object({
  name:           NonEmptyString,
  slug:           z.string().max(80).optional().nullable(),
  cuisine:        OptionalString,
  tagline:        OptionalString,
  description:    OptionalString,
  logoUrl:        OptionalUrl,
  coverImageUrl:  OptionalUrl,
  contactEmail:   OptionalEmail,
  contactPhone:   OptionalString,
  commissionPct:  z.number().min(0).max(100).default(15)
});

const BrandSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('solo') }),
  z.object({ mode: z.literal('existing'), brandId: NonEmptyString }),
  z.object({
    mode: z.literal('new'),
    name: NonEmptyString,
    slug: z.string().max(80).optional().nullable(),
    tagline: OptionalString
  })
]);

const BranchSchema = z.object({
  name:             NonEmptyString,
  line1:            NonEmptyString,
  city:             NonEmptyString,
  state:            OptionalString,
  postalCode:       NonEmptyString,
  country:          z.string().default('IN'),
  latitude:         z.number(),
  longitude:        z.number(),
  serviceRadiusKm:  z.number().min(0.5).max(50).default(7),
  taxRatePct:       z.number().min(0).max(40).default(5),
  baseDeliveryFee:  z.number().min(0).max(2000).default(40),
  perKmDeliveryFee: z.number().min(0).max(200).default(8)
});

const StaffSchema = z.object({
  role: z.enum(['ADMIN', 'KITCHEN']),
  email: z.string().email(),
  // tempPassword is generated client-side so the user sees the same value the
  // wizard shows them. We still re-validate length to stop dud submits.
  tempPassword: z.string().min(8).max(64),
  name: OptionalString
});

const RiderSchema = z.object({
  phone: z.string().min(6).max(20),
  name: OptionalString,
  vehicleType: z.enum(['BIKE', 'SCOOTER', 'BICYCLE']).default('BIKE'),
  vehicleNumber: OptionalString
});

const Body = z.object({
  identity: IdentitySchema,
  brand: BrandSchema,
  branch: BranchSchema,
  staff: z.array(StaffSchema).min(2),
  riders: z.array(RiderSchema).default([]),
  seedStarterMenu: z.boolean().default(true)
});

type ParsedBody = z.infer<typeof Body>;

// ── Helpers ────────────────────────────────────────────────────────────────

async function uniqueRestaurantSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (n < 1000) {
    const hit = await prisma.restaurant.findUnique({ where: { slug } });
    if (!hit) return slug;
    slug = `${base}-${n++}`;
  }
  throw new Error('Could not find a free slug');
}

async function uniqueBranchSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (n < 1000) {
    const hit = await prisma.branch.findUnique({ where: { slug } });
    if (!hit) return slug;
    slug = `${base}-${n++}`;
  }
  throw new Error('Could not find a free branch slug');
}

async function uniqueBrandSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (n < 1000) {
    const hit = await (prisma as any).brand.findUnique({ where: { slug } });
    if (!hit) return slug;
    slug = `${base}-${n++}`;
  }
  throw new Error('Could not find a free brand slug');
}

function isJsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ error: code, message, ...(extra ?? {}) }, { status });
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  await requireSuperAdmin();
  const session = await auth();
  const actorId = session?.user?.id;

  let body: ParsedBody;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return isJsonError(400, 'INVALID_BODY', 'Validation failed', { issues: e.flatten() });
    }
    return isJsonError(400, 'INVALID_BODY', (e as Error).message);
  }

  // Restaurant slug — reject reserved values up front so the super-admin sees
  // a clean error instead of a P2002 collision later.
  const restSlugBase = normaliseRestaurantSlug(body.identity.slug ?? null, body.identity.name);
  if (!restSlugBase) {
    return isJsonError(400, 'INVALID_SLUG', 'Slug is reserved or otherwise invalid.');
  }

  // Lat / lng range guard.
  if (!isValidLatLng(body.branch.latitude, body.branch.longitude)) {
    return isJsonError(400, 'INVALID_COORDS', 'Latitude or longitude is out of range.');
  }

  // Email uniqueness for every staff row — we want a clean 409 instead of a
  // partway-through transaction abort.
  const staffEmails = body.staff.map((s) => s.email.toLowerCase().trim());
  if (new Set(staffEmails).size !== staffEmails.length) {
    return isJsonError(400, 'DUPLICATE_EMAIL', 'Each staff email must be unique within the wizard.');
  }
  const existingByEmail = await prisma.user.findMany({
    where: { email: { in: staffEmails } },
    select: { email: true }
  });
  if (existingByEmail.length > 0) {
    return isJsonError(409, 'EMAIL_TAKEN', 'One or more staff emails are already registered.', {
      emails: existingByEmail.map((u) => u.email)
    });
  }

  // Rider phone uniqueness ─ same defensive check.
  const riderPhones = body.riders.map((r) => r.phone.trim()).filter(Boolean);
  if (new Set(riderPhones).size !== riderPhones.length) {
    return isJsonError(400, 'DUPLICATE_PHONE', 'Rider phone numbers must be unique within the wizard.');
  }
  if (riderPhones.length > 0) {
    const existingPhones = await prisma.user.findMany({
      where: { phone: { in: riderPhones } },
      select: { phone: true }
    });
    if (existingPhones.length > 0) {
      return isJsonError(409, 'PHONE_TAKEN', 'One or more rider phone numbers are already registered.', {
        phones: existingPhones.map((u) => u.phone)
      });
    }
  }

  // Exactly one admin row required, plus at least one kitchen row.
  const adminRow = body.staff.find((s) => s.role === 'ADMIN');
  const kitchenRows = body.staff.filter((s) => s.role === 'KITCHEN');
  if (!adminRow || kitchenRows.length === 0) {
    return isJsonError(400, 'STAFF_INCOMPLETE', 'Need one ADMIN and at least one KITCHEN user.');
  }

  // Hash all staff passwords up front (argon2 is async but cheap).
  const staffWithHashes = await Promise.all(body.staff.map(async (s) => ({
    ...s,
    email: s.email.toLowerCase().trim(),
    hash: await argon2.hash(s.tempPassword)
  })));
  const adminHashed = staffWithHashes.find((s) => s.role === 'ADMIN')!;
  const kitchenHashed = staffWithHashes.filter((s) => s.role === 'KITCHEN');

  // If we're creating a brand-new Brand, derive its slug now so it's part of
  // the transaction.
  let preparedBrandSlug: string | null = null;
  if (body.brand.mode === 'new') {
    const base = slugifyName(body.brand.slug ?? body.brand.name);
    if (!base) return isJsonError(400, 'INVALID_BRAND_SLUG', 'Brand slug is invalid.');
    preparedBrandSlug = await uniqueBrandSlug(base);
  }

  const restaurantSlug = await uniqueRestaurantSlug(restSlugBase);
  const branchSlug = await uniqueBranchSlug(slugifyName(`${restaurantSlug}-${body.branch.name}`) || `${restaurantSlug}-main`);

  let result: {
    restaurantId: string;
    slug: string;
    brandId: string | null;
    adminCredentials: { email: string; tempPassword: string };
    kitchenCredentials: { email: string; tempPassword: string }[];
    riderCount: number;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
      // 1. Brand (if new)
      let brandId: string | null = null;
      if (body.brand.mode === 'existing') {
        const found = await (tx as any).brand.findUnique({ where: { id: body.brand.brandId } });
        if (!found) throw new Error('BRAND_NOT_FOUND');
        brandId = found.id;
      } else if (body.brand.mode === 'new') {
        const created = await (tx as any).brand.create({
          data: {
            name: body.brand.name,
            slug: preparedBrandSlug!,
            tagline: body.brand.tagline ?? null
          }
        });
        brandId = created.id;
      }

      // 2. Owner ADMIN user
      const ownerUser = await tx.user.create({
        data: {
          email: adminHashed.email,
          name: adminHashed.name ?? null,
          passwordHash: adminHashed.hash,
          role: Role.ADMIN
        }
      });

      // 3. Restaurant
      const restaurant = await tx.restaurant.create({
        data: {
          slug: restaurantSlug,
          name: body.identity.name,
          tagline: body.identity.tagline ?? null,
          description: body.identity.description ?? null,
          cuisine: body.identity.cuisine ?? null,
          logoUrl: body.identity.logoUrl ?? null,
          coverImageUrl: body.identity.coverImageUrl ?? null,
          contactEmail: body.identity.contactEmail ?? null,
          contactPhone: body.identity.contactPhone ?? null,
          commissionPct: body.identity.commissionPct,
          status: 'ACTIVE',
          approvedAt: new Date(),
          ownerUserId: ownerUser.id,
          brandId
        }
      });

      // 4. RestaurantUser membership for owner
      await tx.restaurantUser.create({
        data: { restaurantId: restaurant.id, userId: ownerUser.id, role: Role.ADMIN }
      });

      // 5. First branch
      const branch = await tx.branch.create({
        data: {
          restaurantId: restaurant.id,
          name: body.branch.name,
          slug: branchSlug,
          line1: body.branch.line1,
          city: body.branch.city,
          state: body.branch.state ?? null,
          postalCode: body.branch.postalCode,
          country: body.branch.country ?? 'IN',
          latitude: body.branch.latitude,
          longitude: body.branch.longitude,
          serviceRadiusKm: body.branch.serviceRadiusKm,
          taxRatePct: body.branch.taxRatePct,
          baseDeliveryFee: new Prisma.Decimal(body.branch.baseDeliveryFee),
          perKmDeliveryFee: new Prisma.Decimal(body.branch.perKmDeliveryFee)
        }
      });

      // 6. Additional staff (kitchen) + BranchUser
      for (const k of kitchenHashed) {
        const u = await tx.user.create({
          data: {
            email: k.email,
            name: k.name ?? null,
            passwordHash: k.hash,
            role: Role.KITCHEN
          }
        });
        await tx.restaurantUser.create({
          data: { restaurantId: restaurant.id, userId: u.id, role: Role.KITCHEN }
        });
        await tx.branchUser.create({
          data: { branchId: branch.id, userId: u.id, role: Role.KITCHEN }
        });
      }

      // 7. Optional starter riders.
      for (const r of body.riders) {
        const phone = r.phone.trim();
        const u = await tx.user.create({
          data: {
            phone,
            name: r.name ?? null,
            role: Role.RIDER
          }
        });
        await tx.riderProfile.create({
          data: {
            userId: u.id,
            branchId: branch.id,
            vehicleType: r.vehicleType,
            vehicleNumber: r.vehicleNumber ?? null
            // approvedAt left NULL — KYC still required before the rider can
            // claim live orders.
          }
        });
      }

      // 8. Seed starter menu (one Category + three placeholder items) so the
      // customer-facing page doesn't render empty before the admin logs in.
      if (body.seedStarterMenu) {
        const category = await tx.category.create({
          data: {
            branchId: branch.id,
            name: 'Starter menu',
            slug: 'starter-menu',
            sortOrder: 0
          }
        });
        const placeholders = [
          { name: 'Signature Dish',  price: 199, slug: 'signature-dish' },
          { name: 'House Special',   price: 249, slug: 'house-special' },
          { name: "Chef's Pick",     price: 299, slug: 'chefs-pick' }
        ];
        for (let i = 0; i < placeholders.length; i++) {
          const p = placeholders[i]!;
          await tx.menuItem.create({
            data: {
              branchId: branch.id,
              categoryId: category.id,
              name: p.name,
              slug: p.slug,
              price: new Prisma.Decimal(p.price),
              sortOrder: i,
              isAvailable: false // hidden until the admin reviews them
            }
          });
        }
      }

      return {
        restaurantId: restaurant.id,
        slug: restaurant.slug,
        brandId,
        adminCredentials: { email: adminHashed.email, tempPassword: adminRow.tempPassword },
        kitchenCredentials: kitchenHashed.map((k, i) => ({
          email: k.email,
          tempPassword: kitchenRows[i]!.tempPassword
        })),
        riderCount: body.riders.length
      };
    });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Slug / email / phone race we didn't catch above.
      return isJsonError(409, 'UNIQUE_VIOLATION', 'A field with this value already exists.', {
        target: (e.meta as any)?.target ?? null
      });
    }
    if ((e as Error).message === 'BRAND_NOT_FOUND') {
      return isJsonError(404, 'BRAND_NOT_FOUND', 'The selected brand no longer exists.');
    }
    log.error({ err: e }, 'restaurant wizard transaction failed');
    return isJsonError(500, 'WIZARD_FAILED', (e as Error).message ?? 'Wizard failed');
  }

  await audit('restaurant.wizard.create', {
    actorId,
    actorRole: session?.user?.role,
    restaurantId: result.restaurantId,
    entityId: result.restaurantId,
    after: {
      restaurantId: result.restaurantId,
      slug: result.slug,
      brandId: result.brandId,
      adminEmail: result.adminCredentials.email,
      kitchenEmails: result.kitchenCredentials.map((k) => k.email),
      riderCount: result.riderCount,
      seededStarterMenu: body.seedStarterMenu
    },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent')
  }).catch((err) => log.error({ err }, 'audit log restaurant.wizard.create failed'));

  return Response.json(result, { status: 201 });
}
