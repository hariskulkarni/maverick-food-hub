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
} from '@prisma/client';

const prisma = new PrismaClient();

// Bengaluru anchor points — matches the sample tenant's city.
const SURGE_ZONES = [
  {
    name: 'Indiranagar',
    label: 'Dinner rush',
    centerLat: 12.9719,
    centerLng: 77.6412,
    radiusKm: 2.5,
    multiplier: 1.6,
  },
  {
    name: 'Koramangala',
    label: 'Busy area',
    centerLat: 12.9352,
    centerLng: 77.6245,
    radiusKm: 3.0,
    multiplier: 1.8,
  },
  {
    name: 'HSR Layout',
    label: 'High demand',
    centerLat: 12.9116,
    centerLng: 77.6473,
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
