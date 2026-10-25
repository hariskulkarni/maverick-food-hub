/**
 * Seed the Flavrly starter training library (riders, kitchen, restaurant admins).
 *
 * IDEMPOTENT + MIGRATION-SAFE:
 *   • Modules are matched by `slug`; failing that, a pre-v2 row with one of the
 *     module's `legacyAliases` titles is ADOPTED (same id → rider progress and
 *     backfilled certificates survive).
 *   • A module that already has lessons is left alone (admin edits are never
 *     clobbered) unless `--force` is passed.
 *   • When content replaces a module learners already hold certificates for,
 *     the version is bumped so they re-certify on the new content.
 *   • Nothing is ever deleted.
 *
 * Run:  npm run db:seed:training            (from apps/web)
 *       npm run db:seed:training -- --force (re-apply seed content, bumps versions)
 */
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { RIDER_MODULES } from '../src/server/training/seed-content/rider';
import { STAFF_MODULES } from '../src/server/training/seed-content/staff';
import { applyModuleContent } from '../src/server/training/authoring';
import type { SeedModule } from '../src/server/training/types';

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();
const FORCE = process.argv.includes('--force');

const SEED_LIBRARY: SeedModule[] = [...RIDER_MODULES, ...STAFF_MODULES];

async function findExisting(def: SeedModule) {
  const bySlug = await prisma.trainingModule.findUnique({ where: { slug: def.slug } });
  if (bySlug) return bySlug;
  if (!def.legacyAliases?.length) return null;
  return prisma.trainingModule.findFirst({
    where: { slug: null, title: { in: def.legacyAliases, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });
}

async function main() {
  const summary = { created: 0, adopted: 0, skipped: 0, forced: 0, bumped: 0 };
  for (const def of SEED_LIBRARY) {
    const existing = await findExisting(def);
    const content = {
      title: def.title,
      summary: def.summary,
      category: def.category,
      audience: def.audience,
      durationMin: def.durationMin,
      order: def.order,
      isRequired: def.isRequired,
      isActive: true,
      blocksShift: def.blocksShift ?? false,
      passMarkPct: def.passMarkPct,
      maxAttempts: def.maxAttempts,
      retakeCooldownMin: def.retakeCooldownMin,
      dueDays: def.dueDays,
      translations: def.translations ?? null,
      lessons: def.lessons.map((l) => ({ ...l, id: undefined, body: l.body ?? '' })),
      questions: def.questions.map((q) => ({ ...q, id: undefined })),
    };

    if (!existing) {
      const created = await prisma.trainingModule.create({
        data: { slug: def.slug, title: def.title, contentBody: def.summary, category: def.category, audience: def.audience, contentVersion: 2 },
      });
      await prisma.$transaction((tx) => applyModuleContent(tx, created.id, content), { timeout: 30_000 });
      summary.created++;
      console.log(`  + created  ${def.slug}`);
      continue;
    }

    if (!existing.slug) await prisma.trainingModule.update({ where: { id: existing.id }, data: { slug: def.slug } });
    const lessonCount = await prisma.trainingLesson.count({ where: { moduleId: existing.id } });
    if (lessonCount > 0 && !FORCE) {
      summary.skipped++;
      console.log(`  = kept     ${def.slug} (already has ${lessonCount} lessons; use --force to overwrite)`);
      continue;
    }
    const certs = await prisma.trainingCertificate.count({ where: { moduleId: existing.id, moduleVersion: existing.version } });
    const bumpVersion = certs > 0;
    await prisma.$transaction((tx) => applyModuleContent(tx, existing.id, { ...content, bumpVersion }), { timeout: 30_000 });
    if (lessonCount > 0) summary.forced++;
    else summary.adopted++;
    if (bumpVersion) summary.bumped++;
    console.log(
      `  ~ ${lessonCount > 0 ? 'forced ' : 'adopted'} ${def.slug} ← "${existing.title}"${bumpVersion ? ` (v${existing.version}→v${existing.version + 1}, ${certs} learner(s) must re-certify)` : ''}`,
    );
  }
  console.log(`\n→ done: ${JSON.stringify(summary)}`);
}

main()
  .catch((e) => {
    console.error('Training seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
