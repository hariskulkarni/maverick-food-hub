/**
 * Integrated demo — Flavrly side (LOCAL ONLY, fake data). Run with tsx inside a scratch Flavrly
 * worktree after `prisma/seed.ts`, against the disposable demo database.
 *
 * Creates the Flavrly restaurant "Flavrly Test Kitchen" (ACTIVE, auto-accept OFF so LEAD-1's
 * "READY accepts" path is visible) with its admin, one Bengaluru branch open all day with a
 * delivery zone copied from the stock seed, and a test customer + test rider through the real
 * test-account functions (their OTP shows on screen; test riders only see test-customer orders).
 * The menu is NOT seeded here: the demo imports it from Novaryq through the admin UI.
 */
import argon2 from 'argon2';
import { Role, RestaurantStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { createTestAccount } from '@/server/test-accounts';

export const FL_DEMO = {
  adminEmail: 'admin@flavrly-test-kitchen.local',
  adminPassword: 'Admin@12345', // same convention as the stock seed; local only
  restaurantSlug: 'flavrly-test-kitchen',
  branchSlug: 'flavrly-test-kitchen-indiranagar',
  customerPhone: '+919990000101',
  riderPhone: '+919990000202',
};

async function main() {
  const passwordHash = await argon2.hash(FL_DEMO.adminPassword);
  const admin = await prisma.user.upsert({
    where: { email: FL_DEMO.adminEmail },
    update: { passwordHash, role: Role.ADMIN },
    create: { email: FL_DEMO.adminEmail, role: Role.ADMIN, name: 'Asha (Flavrly Test Kitchen)', passwordHash },
  });
  const restaurant = await prisma.restaurant.upsert({
    where: { slug: FL_DEMO.restaurantSlug },
    update: { status: RestaurantStatus.ACTIVE, autoAcceptOrders: false },
    create: {
      slug: FL_DEMO.restaurantSlug,
      name: 'Flavrly Test Kitchen',
      tagline: 'Demo restaurant on Novaryq India POS',
      description: 'Local integrated demo: menu, kitchen and prices come from Novaryq India.',
      cuisine: 'Indian',
      contactEmail: 'kitchen@flavrly-test-kitchen.local',
      contactPhone: '+919800000001',
      status: RestaurantStatus.ACTIVE,
      approvedAt: new Date(),
      ownerUserId: admin.id,
      autoAcceptOrders: false,
    },
  });
  await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: restaurant.id, userId: admin.id } },
    update: {},
    create: { restaurantId: restaurant.id, userId: admin.id, role: Role.ADMIN },
  });

  // Copy the stock seed branch geography so delivery pricing / zones work out of the box.
  const template = await prisma.branch.findFirstOrThrow({ where: { slug: 'saffron-smoke-indiranagar' }, include: { deliveryZones: true } });
  let branch = await prisma.branch.findUnique({ where: { slug: FL_DEMO.branchSlug } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Flavrly Test Kitchen — Indiranagar',
        slug: FL_DEMO.branchSlug,
        phone: '+919800000001',
        line1: '12 Demo Road, Indiranagar',
        city: template.city,
        state: template.state,
        postalCode: template.postalCode,
        country: 'IN',
        latitude: template.latitude,
        longitude: template.longitude,
        serviceRadiusKm: template.serviceRadiusKm,
        taxRatePct: 5,
        baseDeliveryFee: template.baseDeliveryFee,
        perKmDeliveryFee: template.perKmDeliveryFee,
        packagingFee: 10 as any,
        hours: { create: Array.from({ length: 7 }).map((_, i) => ({ dayOfWeek: i, openMin: 0, closeMin: 1439 })) },
      },
    });
    for (const z of template.deliveryZones) {
      const { id: _id, branchId: _b, createdAt: _c, updatedAt: _u, ...rest } = z as any;
      await (prisma as any).deliveryZone.create({ data: { ...rest, branchId: branch.id } });
    }
  }

  const cust = await createTestAccount(FL_DEMO.customerPhone, 'Priya (demo customer)', 'CUSTOMER');
  const rider = await createTestAccount(FL_DEMO.riderPhone, 'Imran (demo rider)', 'RIDER');
  const customer = await prisma.user.findUniqueOrThrow({ where: { phone: FL_DEMO.customerPhone } });
  // A saved address inside the branch's delivery area (copied from a stock-seed customer address).
  const tmplAddr = await prisma.address.findFirst({ where: { user: { phone: '+919876500001' } } });
  if (tmplAddr && !(await prisma.address.findFirst({ where: { userId: customer.id } }))) {
    const { id: _id, userId: _u, createdAt: _c, updatedAt: _up, ...rest } = tmplAddr as any;
    await prisma.address.create({ data: { ...rest, userId: customer.id, isDefault: true, label: 'Home' } });
  }

  console.log(`FL_RESTAURANT_ID=${restaurant.id}`);
  console.log(`FL_BRANCH_ID=${branch.id}`);
  console.log(`FL_ADMIN_EMAIL=${FL_DEMO.adminEmail}`);
  console.log(`FL_ADMIN_PASSWORD=${FL_DEMO.adminPassword}`);
  console.log(`FL_CUSTOMER_PHONE=${FL_DEMO.customerPhone}`);
  console.log(`FL_RIDER_PHONE=${FL_DEMO.riderPhone}`);
  console.error(`test accounts: customer ${cust.ok ? 'ok' : cust.message}; rider ${rider.ok ? 'ok' : rider.message}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
