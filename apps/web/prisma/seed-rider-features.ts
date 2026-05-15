/**
 * Seed: rider competitor-feature demo data.
 *
 * Populates the platform-level config tables introduced with the native-app
 * feature bundles so the rider app looks alive on first run:
 *   - SurgeZone        → the SurgeBanner has something to show
 *   - RiderIncentive   → the Incentives screen has live targets
 *   - TrainingModule   → the Training & Certification screen has a curriculum
 *
 * Per-rider rows (payouts, SOS alerts, referrals, support tickets, progress)
 * are intentionally NOT seeded — those are created by riders using the app.
 *
 * Idempotent: clears and re-creates only these three config tables. Run with
 *   npm run db:seed:rider-features
 */
import {
  PrismaClient,
  IncentivePeriod,
  TrainingCategory,
  RiderType,
  RiderDispatchMode,
  KycDocumentType,
  OrderStatus,
  PaymentMethod,
  Role,
} from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Guntur, Andhra Pradesh anchor points — matches the sample tenant's areas.
const SURGE_ZONES = [
  {
    name: 'Guntur Brodipet',
    label: 'Dinner rush',
    centerLat: 16.3010,
    centerLng: 80.4360,
    radiusKm: 2.5,
    multiplier: 1.6,
  },
  {
    name: 'Guntur Arundelpet',
    label: 'Busy area',
    centerLat: 16.3050,
    centerLng: 80.4420,
    radiusKm: 3.0,
    multiplier: 1.8,
  },
  {
    name: 'Guntur Lakshmipuram',
    label: 'High demand',
    centerLat: 16.3120,
    centerLng: 80.4290,
    radiusKm: 2.0,
    multiplier: 1.4,
  },
];

const INCENTIVES = [
  {
    title: 'Daily 10',
    description: 'Complete 10 deliveries today and earn a flat bonus on top of your payouts.',
    period: IncentivePeriod.DAILY,
    targetDeliveries: 10,
    bonusAmount: 150,
  },
  {
    title: 'Power Hour Push',
    description: 'Finish 5 deliveries today — a quick win to kick-start your earnings.',
    period: IncentivePeriod.DAILY,
    targetDeliveries: 5,
    bonusAmount: 60,
  },
  {
    title: 'Weekly Champion',
    description: 'Hit 60 deliveries this week to unlock the top weekly bonus.',
    period: IncentivePeriod.WEEKLY,
    targetDeliveries: 60,
    bonusAmount: 1200,
  },
  {
    title: 'Weekend Warrior',
    description: 'Stack 25 deliveries across the week and earn a steady bonus.',
    period: IncentivePeriod.WEEKLY,
    targetDeliveries: 25,
    bonusAmount: 400,
  },
];

const TRAINING_MODULES = [
  {
    title: 'Welcome to Oak & Sizzler',
    summary: 'How the rider app works and what to expect on your first day.',
    category: TrainingCategory.ONBOARDING,
    durationMin: 4,
    order: 1,
    isRequired: true,
    contentBody: `# Welcome aboard

You're now part of the Oak & Sizzler delivery fleet. This short guide walks you through your first shift.

## Going online
- Open the **Home** tab and flip the online switch.
- Stay online to receive new order pings.
- Use **Break mode** when you need to pause without going fully offline.

## Claiming an order
- Open the **Orders** tab to see the live pool.
- Tap an order to see the payout, pickup and drop.
- Claim it — then head to the restaurant.

## Getting paid
- Every completed delivery adds to your balance.
- Use **Instant Payout** on the Earnings tab to withdraw to UPI any time.

You're all set. Ride safe.`,
  },
  {
    title: 'Completing a delivery, step by step',
    summary: 'Pickup, OTP hand-over and proof of delivery — done right.',
    category: TrainingCategory.APP_GUIDE,
    durationMin: 5,
    order: 2,
    isRequired: true,
    contentBody: `# The delivery flow

Every order moves through the same clear steps.

## At the restaurant
- Tap **Reached restaurant** when you arrive.
- Collect the food and tap **Picked up**.

## At the customer
- Tap **Reached customer** at the door.
- Ask the customer for their 4-digit **delivery OTP**.
- Enter it to confirm the hand-over.

## Proof of delivery
- Snap the proof photo when prompted.
- This protects you if there's ever a dispute.

That's it — the payout lands in your balance instantly.`,
  },
  {
    title: 'Staying safe on the road',
    summary: 'SOS, sharing your trip, and what to do in an emergency.',
    category: TrainingCategory.SAFETY,
    durationMin: 6,
    order: 3,
    isRequired: true,
    contentBody: `# Your safety comes first

The app has tools built in for the moments that matter.

## The SOS button
- Find it in the **Safety Centre** and on the active delivery screen.
- One tap captures your location and alerts your primary emergency contact.
- Only use it for genuine emergencies.

## Share your live trip
- From the Safety Centre, tap **Share my live trip**.
- Send the link to family — they can follow your location until the trip ends.

## Add emergency contacts
- Add at least one contact before your first shift.
- Mark one as **primary** — that's who gets alerted on SOS.

## Reporting an incident
- Accident, harassment, breakdown or theft — file a report from the Safety Centre.
- Add a photo and your location so the safety team can act fast.

Ride defensively. Wear your helmet. No delivery is worth your safety.`,
  },
  {
    title: 'Five-star customer service',
    summary: 'Small habits that keep your rating high.',
    category: TrainingCategory.CUSTOMER_SERVICE,
    durationMin: 5,
    order: 4,
    isRequired: false,
    contentBody: `# Earning five stars

Your rating opens doors — higher tiers, priority orders, better earnings.

## Before you arrive
- Call ahead if the address is unclear.
- Keep the food upright and the bag sealed.

## At the door
- Greet the customer warmly.
- Hand over the order with both hands.
- Confirm the OTP politely.

## If something goes wrong
- Stay calm and courteous.
- Use the in-app **Help & Support** to raise an issue rather than arguing.

A friendly 30 seconds at the door is the difference between three stars and five.`,
  },
  {
    title: 'Maximising your earnings',
    summary: 'Surge, incentives, tiers and shifts — how the money adds up.',
    category: TrainingCategory.EARNINGS,
    durationMin: 6,
    order: 5,
    isRequired: false,
    contentBody: `# Make every hour count

Your payout is base + bonus + tip. Here's how to grow each part.

## Chase the surge
- Watch the **surge banner** on Home and Earnings.
- Surge zones pay a multiplier — ride towards them.

## Hit your incentives
- The **Incentives** screen shows live daily and weekly targets.
- Completing a slab adds a flat bonus on top of payouts.

## Climb the tiers
- More deliveries and a higher rating move you up: Bronze to Platinum.
- Higher tiers unlock priority pool access and better support.

## Book your shifts
- Reserve high-demand windows in advance from **My Shifts**.

Plan your day around surge and incentives and your earnings climb fast.`,
  },
  {
    title: 'Handling cash-on-delivery orders',
    summary: 'Collecting cash and depositing it correctly.',
    category: TrainingCategory.APP_GUIDE,
    durationMin: 4,
    order: 6,
    isRequired: false,
    contentBody: `# Cash-on-delivery, done right

Some orders are paid in cash. The app keeps the maths simple.

## Collecting
- The order screen shows the exact amount to collect.
- Count the cash with the customer before you leave.

## Tracking
- Open **Cash in Hand** on the Earnings tab.
- It shows the total cash you're holding to deposit.

## Depositing
- Deposit collected cash at your assigned point regularly.
- Once reconciled, it clears from your Cash in Hand.

Keep your cash balance low — deposit often.`,
  },
];

// Maps each KYC document type → the real demo asset shipped under
// apps/web/public/demo/kyc/ (served by Next at /demo/kyc/...). The cuisines
// seed left every fileUrl pointing at a fake cdn.example host that 404s.
const KYC_DOC_ASSETS: Record<
  KycDocumentType,
  { fileUrl: string; fileName: string; fileMimeType: string }
> = {
  [KycDocumentType.AADHAAR]: {
    fileUrl: '/demo/kyc/aadhaar.png',
    fileName: 'Aadhaar.png',
    fileMimeType: 'image/png',
  },
  [KycDocumentType.DRIVING_LICENSE]: {
    fileUrl: '/demo/kyc/driving-license.png',
    fileName: 'Driving-License.png',
    fileMimeType: 'image/png',
  },
  [KycDocumentType.VEHICLE_INSURANCE]: {
    fileUrl: '/demo/kyc/vehicle-insurance.png',
    fileName: 'Vehicle-Insurance.png',
    fileMimeType: 'image/png',
  },
  [KycDocumentType.VEHICLE_RC]: {
    fileUrl: '/demo/kyc/vehicle-rc.png',
    fileName: 'Vehicle-RC.png',
    fileMimeType: 'image/png',
  },
  [KycDocumentType.PAN_CARD]: {
    fileUrl: '/demo/kyc/pan-card.png',
    fileName: 'PAN-Card.png',
    fileMimeType: 'image/png',
  },
};

async function main() {
  console.log('Seeding rider competitor-feature demo data…');

  // ── Surge zones ────────────────────────────────────────────────────────────
  await prisma.surgeZone.deleteMany({});
  for (const z of SURGE_ZONES) {
    await prisma.surgeZone.create({ data: { ...z, isActive: true } });
  }
  console.log(`  ✓ ${SURGE_ZONES.length} surge zones`);

  // ── Incentives ─────────────────────────────────────────────────────────────
  await prisma.riderIncentive.deleteMany({});
  for (const i of INCENTIVES) {
    await prisma.riderIncentive.create({ data: { ...i, isActive: true } });
  }
  console.log(`  ✓ ${INCENTIVES.length} incentive slabs`);

  // ── Training modules ───────────────────────────────────────────────────────
  await prisma.trainingModule.deleteMany({});
  for (const m of TRAINING_MODULES) {
    await prisma.trainingModule.create({ data: { ...m, isActive: true } });
  }
  console.log(`  ✓ ${TRAINING_MODULES.length} training modules`);

  // ── Rider types & restaurant dispatch mode (demo) ──────────────────────────
  // Make one ACTIVE restaurant run "dedicated-first" with a couple of its own
  // dedicated riders, so the FLEET vs DEDICATED split is visible in a demo.
  // Idempotent: re-running just re-applies the same assignment.
  const restaurant = await prisma.restaurant.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });
  if (restaurant) {
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { riderDispatchMode: RiderDispatchMode.DEDICATED_FIRST, fleetFallbackMinutes: 5 },
    });
    const approvedRiders = await prisma.riderProfile.findMany({
      where: { approvedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    // First 2 approved riders → dedicated to this restaurant; the rest → fleet.
    const dedicatedIds = approvedRiders.slice(0, 2).map((r) => r.id);
    const fleetIds = approvedRiders.slice(2).map((r) => r.id);
    if (dedicatedIds.length > 0) {
      await prisma.riderProfile.updateMany({
        where: { id: { in: dedicatedIds } },
        data: { riderType: RiderType.DEDICATED, dedicatedRestaurantId: restaurant.id },
      });
    }
    if (fleetIds.length > 0) {
      await prisma.riderProfile.updateMany({
        where: { id: { in: fleetIds } },
        data: { riderType: RiderType.FLEET, dedicatedRestaurantId: null },
      });
    }
    console.log(
      `  ✓ ${restaurant.name} → DEDICATED_FIRST · ${dedicatedIds.length} dedicated, ${fleetIds.length} fleet riders`,
    );
  } else {
    console.log('  • no ACTIVE restaurant found — skipped rider-type demo setup');
  }

  // ── Fix KYC document images ────────────────────────────────────────────────
  // The cuisines seed set every RiderKycDocument.fileUrl to a fake
  // https://cdn.example/...jpg that 404s. Re-point each row at the matching
  // real demo asset. One updateMany per KycDocumentType — idempotent.
  let kycFixed = 0;
  for (const type of Object.values(KycDocumentType)) {
    const asset = KYC_DOC_ASSETS[type];
    const res = await prisma.riderKycDocument.updateMany({
      where: { type },
      data: {
        fileUrl: asset.fileUrl,
        fileName: asset.fileName,
        fileMimeType: asset.fileMimeType,
      },
    });
    kycFixed += res.count;
  }
  console.log(`  ✓ ${kycFixed} KYC documents re-pointed at /demo/kyc/*.png`);

  // ── Rider avatars ──────────────────────────────────────────────────────────
  // Round-robin the 8 demo avatars across every rider's User row. Ordered by
  // createdAt so the mapping is stable across re-runs.
  const allRiders = await prisma.riderProfile.findMany({
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  let avatarsSet = 0;
  for (let i = 0; i < allRiders.length; i++) {
    await prisma.user.update({
      where: { id: allRiders[i].userId },
      data: { avatarUrl: `/demo/avatars/avatar-${(i % 8) + 1}.png` },
    });
    avatarsSet++;
  }
  console.log(`  ✓ ${avatarsSet} rider avatars assigned`);

  // ── Live pool orders ───────────────────────────────────────────────────────
  // Create a fresh batch of READY, unassigned orders so the rider pool isn't
  // empty. Idempotent: every order gets a `POOL-…` code, and we wipe the prior
  // batch first (OrderItem cascades on Order delete, RiderAssignment is null).
  await prisma.order.deleteMany({ where: { code: { startsWith: 'POOL-' } } });

  const activeRestaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  // Guntur, Andhra Pradesh drop-point spread: lat ~16.28–16.34 N, lng ~80.41–80.48 E.
  const POOL_LAT_MIN = 16.28;
  const POOL_LAT_MAX = 16.34;
  const POOL_LNG_MIN = 80.41;
  const POOL_LNG_MAX = 80.48;
  const lerp = (min: number, max: number, t: number) =>
    +(min + (max - min) * t).toFixed(6);

  let poolOrders = 0;
  for (const restaurant of activeRestaurants) {
    const branch = await prisma.branch.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) continue;

    const menuItems = await prisma.menuItem.findMany({
      where: { branchId: branch.id },
      orderBy: { sortOrder: 'asc' },
      take: 12,
      select: { id: true, name: true, price: true },
    });
    if (menuItems.length === 0) continue;

    // Reuse a seeded customer for this restaurant, else create a pool customer.
    let customer = await prisma.user.findFirst({
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'asc' },
    });
    if (!customer) {
      customer = await prisma.user.upsert({
        where: { phone: '+919800000000' },
        update: { role: 'CUSTOMER', name: 'Pool Demo Customer' },
        create: { role: 'CUSTOMER', name: 'Pool Demo Customer', phone: '+919800000000' },
      });
    }

    const slugTag = restaurant.slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

    for (let n = 1; n <= 4; n++) {
      const code = `POOL-${slugTag}-${n}`;

      // Vary the drop point deterministically across the Guntur box.
      const latT = ((n * 17 + restaurant.slug.length * 7) % 100) / 100;
      const lngT = ((n * 31 + restaurant.slug.length * 13) % 100) / 100;
      const address = await prisma.address.create({
        data: {
          userId: customer.id,
          label: 'Pool Drop',
          line1: `Pool delivery point ${n} for ${restaurant.name}`,
          city: 'Guntur',
          state: 'AP',
          postalCode: '522002',
          latitude: lerp(POOL_LAT_MIN, POOL_LAT_MAX, latT),
          longitude: lerp(POOL_LNG_MIN, POOL_LNG_MAX, lngT),
          isDefault: false,
        },
      });

      // 1–3 real MenuItems of this restaurant's branch.
      const itemCount = ((n - 1) % 3) + 1;
      const picks: { id: string; name: string; price: number }[] = [];
      for (let k = 0; k < itemCount; k++) {
        const it = menuItems[(n + k) % menuItems.length];
        picks.push({ id: it.id, name: it.name, price: Number(it.price) });
      }

      const subtotal = +picks.reduce((s, p) => s + p.price, 0).toFixed(2);
      const tax = +(subtotal * 0.05).toFixed(2);
      const fee = 40;
      const total = +(subtotal + tax + fee).toFixed(2);

      // placedAt recent, readyAt a few minutes ago — keeps the pool "fresh".
      const placedAt = new Date(Date.now() - (n * 9 + 15) * 60_000);
      const readyAt = new Date(Date.now() - (n + 2) * 60_000);

      await prisma.order.create({
        data: {
          code,
          branchId: branch.id,
          customerId: customer.id,
          addressId: address.id,
          status: OrderStatus.READY,
          subtotal: subtotal as any,
          taxAmount: tax as any,
          deliveryFee: fee as any,
          discountAmount: 0 as any,
          total: total as any,
          paymentMethod: n % 2 === 0 ? PaymentMethod.RAZORPAY : PaymentMethod.COD,
          placedAt,
          acceptedAt: new Date(placedAt.getTime() + 60_000),
          preparingAt: new Date(placedAt.getTime() + 90_000),
          readyAt,
          items: {
            create: picks.map((p) => ({
              menuItemId: p.id,
              name: p.name,
              quantity: 1,
              unitPrice: p.price as any,
            })),
          },
        },
      });
      poolOrders++;
    }
  }
  console.log(
    `  ✓ ${poolOrders} live pool orders (READY, unassigned) across ${activeRestaurants.length} restaurants`,
  );

  // ── Super-admin account ────────────────────────────────────────────────────
  // The cuisines seed creates per-restaurant admins + kitchen users but no
  // platform super-admin. Guarantee one here so the demo is self-contained.
  const superPass = await argon2.hash('Super@12345');
  await prisma.user.upsert({
    where: { email: 'super@platform.local' },
    update: { role: Role.SUPER_ADMIN, passwordHash: superPass },
    create: {
      email: 'super@platform.local',
      name: 'Platform Super Admin',
      role: Role.SUPER_ADMIN,
      passwordHash: superPass,
    },
  });
  console.log('  ✓ super-admin: super@platform.local / Super@12345');

  // ── Print the full demo-account directory ──────────────────────────────────
  // Queries the DB so the credentials list always reflects reality. Staff
  // (admin/kitchen) come from RestaurantUser memberships; riders + customers
  // are listed flat — the cuisines seed names them "<Restaurant> Rider N" /
  // "<Restaurant> Patron A" so they stay grouped-readable.
  console.log('\n────────────────────────────────────────────────────────');
  console.log(' DEMO ACCOUNTS');
  console.log('────────────────────────────────────────────────────────');
  console.log(' SUPER ADMIN   super@platform.local   / Super@12345');
  console.log('');
  const restaurantsForTable = await prisma.restaurant.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      name: true,
      members: {
        select: { role: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  for (const r of restaurantsForTable) {
    console.log(` ${r.name}`);
    for (const m of r.members) {
      if (!m.user.email) continue;
      const pwd = m.role === 'KITCHEN' ? 'Kitchen@12345' : 'Admin@12345';
      console.log(`   ${m.role.padEnd(8)} ${m.user.email}  / ${pwd}`);
    }
  }
  const riders = await prisma.user.findMany({
    where: { role: Role.RIDER, phone: { not: null } },
    orderBy: { name: 'asc' },
    select: { name: true, phone: true },
  });
  const customers = await prisma.user.findMany({
    where: { role: Role.CUSTOMER, phone: { not: null } },
    orderBy: { name: 'asc' },
    select: { name: true, phone: true },
  });
  console.log(`\n RIDERS (${riders.length}) — phone + OTP, no password`);
  for (const u of riders) console.log(`   ${u.phone}   ${u.name ?? ''}`);
  console.log(`\n CUSTOMERS (${customers.length}) — phone + OTP, no password`);
  for (const u of customers) console.log(`   ${u.phone}   ${u.name ?? ''}`);
  console.log('\n With OTP_DEBUG_LOG=true the OTP is returned in the API response / PM2 logs.');
  console.log('────────────────────────────────────────────────────────\n');

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
