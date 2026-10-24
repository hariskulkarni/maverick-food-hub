import { afterAll, describe, expect, it } from 'vitest';
import { prisma, uid, makeAccount, makeAttempt } from './fixtures';
import { ensurePlatformRestaurant, PLATFORM_RESTAURANT_ID } from '@/server/2fa';
import { expireStaleAttempts, OBSERVED_STALE_MS } from '@/server/pg/attempts';

afterAll(async () => {
  await prisma.$disconnect();
});

// UAT DEFECT-1: on a fresh DB the platform YouPI config save failed with P2003 (no sentinel row).
describe('platform sentinel restaurant (real DB)', () => {
  it('ensurePlatformRestaurant creates the row once, so a platform credential can be stored', async () => {
    await prisma.user.create({ data: { email: `sa-${uid()}@example.test`, role: 'SUPER_ADMIN' } });
    // Other suites in this shared DB may already have created the row (h-support).
    const existed = await prisma.restaurant.findUnique({ where: { id: PLATFORM_RESTAURANT_ID } });
    await ensurePlatformRestaurant();
    await ensurePlatformRestaurant(); // idempotent
    const row = await prisma.restaurant.findUniqueOrThrow({ where: { id: PLATFORM_RESTAURANT_ID } });
    if (!existed) expect(row.status).toBe('SUSPENDED'); // never serves orders
    await expect(
      prisma.integrationCredential.upsert({
        where: { restaurantId_provider: { restaurantId: PLATFORM_RESTAURANT_ID, provider: 'YOUPI' } },
        update: {},
        create: { restaurantId: PLATFORM_RESTAURANT_ID, provider: 'YOUPI', configEncrypted: 'x' },
      }),
    ).resolves.toBeTruthy();
  });
});

// UAT O-3: OBSERVED stale alert was keyed on updatedAt, which every sweep probe bumps.
describe('OBSERVED stale alert (real DB)', () => {
  it('flags an old OBSERVED attempt even when updatedAt is fresh', async () => {
    const acc = await makeAccount();
    const { attempt: a } = await makeAttempt(acc, { state: 'OBSERVED', createdAt: new Date(Date.now() - OBSERVED_STALE_MS - 3_600_000) });
    await prisma.$executeRaw`UPDATE "PgPaymentAttempt" SET "updatedAt" = timezone('utc', now()) WHERE "id" = ${a.id}`;
    await expireStaleAttempts();
    const ex = await prisma.pgReconException.findFirst({ where: { dedupeKey: `STALE_PENDING:${a.id}` } });
    expect(ex).not.toBeNull();
  });
});
