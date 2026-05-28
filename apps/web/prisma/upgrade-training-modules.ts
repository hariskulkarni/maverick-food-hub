/**
 * Upgrade the 6 default training modules to the new Flavrly-branded,
 * block-based, comprehensive content.
 *
 * SAFE TO RE-RUN: it matches existing rows by a curated set of old + new titles
 * and UPDATES them in place (preserving their id, so RiderTrainingProgress is
 * untouched). If a default module is missing, it's CREATED.
 *
 * Run:
 *   npx tsx prisma/upgrade-training-modules.ts
 *   # or
 *   npm run db:upgrade-training
 *
 * On the VPS: same command after `git pull` + `npx prisma generate`.
 */
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_TRAINING_CONTENT } from '../src/server/training-defaults';

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

/**
 * For each default, candidate titles we accept as a match for an existing row.
 * (We migrated the brand from Oak & Sizzler / Bowl & Barbeque → Flavrly, so the
 * old seed titles are listed here so we can find + upgrade them.)
 */
const ALIASES: Record<string, string[]> = {
  'welcome-to-flavrly': [
    'Welcome to Flavrly',
    'Welcome to Oak & Sizzler',
    'Welcome to Bowl & Barbeque',
    'Welcome to Maverick',
    'Welcome',
  ],
  'completing-a-delivery': [
    'Completing a delivery, step-by-step',
    'Completing a delivery, step by step',
    'Completing a delivery',
  ],
  'staying-safe-on-the-road': [
    'Staying safe on the road',
    'Road safety basics',
  ],
  'five-star-customer-service': [
    'Five-star customer service',
    '5-star customer service',
    'Customer service basics',
  ],
  'maximising-your-earnings': [
    'Maximising your earnings',
    'Maximizing your earnings',
    'Earnings playbook',
  ],
  'handling-cod-orders': [
    'Handling cash-on-delivery orders',
    'Handling COD orders',
    'COD basics',
  ],
};

async function main() {
  const before = await prisma.trainingModule.count();
  console.log(`→ found ${before} existing modules`);

  let updated = 0;
  let created = 0;

  for (const def of DEFAULT_TRAINING_CONTENT) {
    const aliases = ALIASES[def.slug] ?? [def.title];
    // Find ANY matching row (case-insensitive) using IN clause.
    const candidates = await prisma.trainingModule.findMany({
      where: { title: { in: aliases, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
    });

    const data = {
      title: def.title,
      summary: def.summary,
      category: def.category,
      contentBody: def.summary, // legacy plain-text fallback for old native clients
      contentBlocks: def.contentBlocks as any,
      heroImageUrl: def.heroImageUrl,
      contentVersion: 2,
      durationMin: def.durationMin,
      order: def.order,
      isRequired: def.isRequired,
      isActive: true,
    };

    if (candidates.length > 0) {
      // Update the oldest (preserving its id) so rider progress survives.
      const head = candidates[0];
      await prisma.trainingModule.update({ where: { id: head.id }, data });
      console.log(`  ✓ updated  "${head.title}"  →  "${def.title}"`);
      // If there were duplicates (rare — old seeds + manual re-seeds), deactivate
      // them so they don't show up in the rider list. We don't delete to keep
      // progress rows intact.
      for (const dup of candidates.slice(1)) {
        await prisma.trainingModule.update({ where: { id: dup.id }, data: { isActive: false } });
        console.log(`    · deactivated dup "${dup.title}" (${dup.id})`);
      }
      updated++;
    } else {
      await prisma.trainingModule.create({ data });
      console.log(`  + created  "${def.title}"`);
      created++;
    }
  }

  const after = await prisma.trainingModule.count();
  console.log(`\n→ done. created=${created}, updated=${updated}, total now=${after}`);
}

main()
  .catch((e) => {
    console.error('Upgrade failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
