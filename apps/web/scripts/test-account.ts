/**
 * Manage pre-launch test accounts (login code shown on screen / in the rider
 * app, no SMS). Run on the server from apps/web:
 *
 *   npx tsx scripts/test-account.ts create --phone 9XXXXXXXXX [--role customer|rider] [--name "..."]
 *   npx tsx scripts/test-account.ts list
 *   npx tsx scripts/test-account.ts delete --phone 9XXXXXXXXX     # launch day
 *
 * `--role` defaults to customer. A phone owned by a real (non-test) account is
 * refused; `--allow-existing-customer` restores the old behaviour of flagging an
 * existing real CUSTOMER (never a rider). Super-admins can do the same at
 * /platform/users/test-accounts.
 *
 * Anyone who knows the number can sign in as this test account while it exists
 * — use a number nobody can guess and delete it before launch.
 */
import { prisma } from '../src/server/db';
import { createTestAccount, deleteTestAccount, listTestAccounts, type TestAccountRole } from '../src/server/test-accounts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function parseRole(raw: string | undefined): TestAccountRole | null {
  if (!raw || raw.toLowerCase() === 'customer') return 'CUSTOMER';
  if (raw.toLowerCase() === 'rider') return 'RIDER';
  return null;
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  if (cmd === 'create' || cmd === 'delete') {
    const phone = arg('phone');
    if (!phone) { console.error(`usage: test-account.ts ${cmd} --phone 9XXXXXXXXX`); return 2; }
    if (cmd === 'delete') {
      const r = await deleteTestAccount(phone);
      console.log(r.message);
      return r.ok ? 0 : 1;
    }
    const role = parseRole(arg('role'));
    if (!role) { console.error('--role must be customer or rider'); return 2; }
    const r = await createTestAccount(phone, arg('name'), role, {
      allowExistingCustomer: process.argv.includes('--allow-existing-customer'),
    });
    console.log(r.message);
    if (r.ok) {
      console.log(
        role === 'RIDER'
          ? `Sign in at flavrly.in/rider/login or in the rider app with ${r.phone}; the code appears on screen.`
          : `Sign in on the site with phone ${r.phone} (type it exactly like this); the code appears on the login screen.`,
      );
    }
    return r.ok ? 0 : 1;
  }
  if (cmd === 'list') {
    const rows = await listTestAccounts();
    if (!rows.length) console.log('No test accounts.');
    for (const u of rows) {
      const state = u.deletedAt ? 'deleted' : u.suspendedAt ? 'suspended' : 'ACTIVE (code shown on screen)';
      console.log(`${u.phone}  ${u.role.toLowerCase().padEnd(8)}  ${u.name ?? ''}  created ${u.createdAt.toISOString().slice(0, 10)}  ${state}`);
    }
    return 0;
  }
  console.error('usage: test-account.ts create|list|delete [--phone 9XXXXXXXXX] [--role customer|rider] [--name "..."]');
  return 2;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
