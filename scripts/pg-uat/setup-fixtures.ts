/**
 * Flavrly PG local synthetic UAT — fixture setup (run BEFORE the app starts, so the app's
 * integration-config cache never holds a stale/negative entry).
 *
 *   cd apps/web && UAT_DIR=... ./node_modules/.bin/tsx ../../scripts/pg-uat/setup-fixtures.ts
 *
 * Synthetic data only. Uses the app's own helpers:
 *   - saveConfig()  (src/server/integrations) -> per-restaurant IntegrationCredential(YOUPI), encrypted
 *                    with INTEGRATION_ENCRYPTION_KEY by encryptJSON()
 *   - encryptJSON() for staff TOTP secrets (same format user-totp.ts decrypts)
 * Writes throwaway staff credentials to $UAT_DIR/staff.json (mode 600, outside git, never evidence).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { encryptJSON } from '@/server/crypto';
import { saveConfig } from '@/server/integrations';

const dir = process.env.UAT_DIR;
if (!dir) throw new Error('UAT_DIR required');
const endpoint = JSON.parse(fs.readFileSync(`${dir}/endpoint.json`, 'utf8')) as { secret: string };
const merchantSecret = process.env.MERCHANT_SECRET;
if (!merchantSecret || !endpoint.secret?.startsWith('whsec_')) throw new Error('missing gateway secrets');

async function main() {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { slug: 'saffron-smoke' } });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { slug: 'saffron-smoke-indiranagar' } });

  // Staff: seed users + one extra SUPER_ADMIN (verifier/approver) + one extra restaurant ADMIN (refund approver).
  const staff: Record<string, { email: string; password: string; totp: string; role: Role }> = {};
  const want: Array<{ key: string; email: string; role: Role; password?: string }> = [
    { key: 'super', email: 'super@platform.local', role: Role.SUPER_ADMIN, password: 'Super@12345' },
    { key: 'super2', email: 'super2@uat.local', role: Role.SUPER_ADMIN },
    { key: 'admin', email: 'admin@restaurant.local', role: Role.ADMIN, password: 'Admin@12345' },
    { key: 'admin2', email: 'admin2@uat.local', role: Role.ADMIN },
    { key: 'kitchen', email: 'kitchen@restaurant.local', role: Role.KITCHEN, password: 'Kitchen@12345' },
  ];
  for (const w of want) {
    const password = w.password ?? `Uat-${crypto.randomBytes(9).toString('base64url')}`;
    const totp = authenticator.generateSecret();
    const user = await prisma.user.upsert({
      where: { email: w.email },
      update: { totpSecret: encryptJSON({ s: totp }), totpEnabledAt: new Date(), ...(w.password ? {} : { passwordHash: await argon2.hash(password) }) },
      create: {
        email: w.email,
        name: `UAT ${w.key}`,
        role: w.role,
        passwordHash: await argon2.hash(password),
        totpSecret: encryptJSON({ s: totp }),
        totpEnabledAt: new Date(),
      },
    });
    if (w.key === 'admin2') {
      await prisma.restaurantUser.upsert({
        where: { restaurantId_userId: { restaurantId: restaurant.id, userId: user.id } },
        update: { role: Role.ADMIN },
        create: { restaurantId: restaurant.id, userId: user.id, role: Role.ADMIN },
      });
    }
    staff[w.key] = { email: w.email, password, totp, role: w.role };
  }

  // Open all day so order placement is independent of the wall clock during the UAT run.
  await prisma.operatingHours.updateMany({ where: { branchId: branch.id }, data: { openMin: 0, closeMin: 24 * 60 - 1 } });

  // Per-restaurant gateway credential (contract D7). merchantKey = the fork merchant's own
  // webhook secret (FORK proves ownership with it, UPSTREAM_CONTRACT.md section 2);
  // webhookSecret = the Standard Webhooks endpoint secret (whsec_...).
  await saveConfig(restaurant.id, 'YOUPI', {
    baseUrl: 'http://127.0.0.1:6611',
    merchantId: '00000000-0000-0000-0000-000000000001',
    merchantKey: merchantSecret!,
    webhookSecret: endpoint.secret,
  });

  fs.writeFileSync(`${dir}/staff.json`, JSON.stringify(staff, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ restaurantId: restaurant.id, branchId: branch.id, staff: Object.keys(staff) }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
