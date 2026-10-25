/**
 * Manage pre-launch test customer accounts (login OTP shown on screen, no SMS).
 * Run on the server from apps/web:
 *
 *   npx tsx scripts/test-account.ts create --phone 9XXXXXXXXX [--name "Flavrly Test Customer"]
 *   npx tsx scripts/test-account.ts list
 *   npx tsx scripts/test-account.ts delete --phone 9XXXXXXXXX     # launch day
 *
 * Anyone who knows the number can sign in as this test customer while it is a
 * test account — use a number nobody can guess and delete it before launch.
 */
import { prisma } from '../src/server/db';
import { createTestAccount, deleteTestAccount, listTestAccounts } from '../src/server/test-accounts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const cmd = process.argv[2];
  if (cmd === 'create' || cmd === 'delete') {
    const phone = arg('phone');
    if (!phone) { console.error(`usage: test-account.ts ${cmd} --phone 9XXXXXXXXX`); return 2; }
    const r = cmd === 'create' ? await createTestAccount(phone, arg('name')) : await deleteTestAccount(phone);
    console.log(r.message);
    if (r.ok && cmd === 'create') {
      console.log(`Sign in on the site with phone ${r.phone} (type it exactly like this); the code appears on the login screen.`);
    }
    return r.ok ? 0 : 1;
  }
  if (cmd === 'list') {
    const rows = await listTestAccounts();
    if (!rows.length) console.log('No test accounts.');
    for (const u of rows) {
      const state = u.deletedAt ? 'deleted' : u.suspendedAt ? 'suspended' : 'ACTIVE (code shown on screen)';
      console.log(`${u.phone}  ${u.name ?? ''}  created ${u.createdAt.toISOString().slice(0, 10)}  ${state}`);
    }
    return 0;
  }
  console.error('usage: test-account.ts create|list|delete [--phone 9XXXXXXXXX] [--name "..."]');
  return 2;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
