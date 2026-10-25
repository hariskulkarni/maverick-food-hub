/**
 * Seed: help-center starter content from apps/web/content/help/**.
 *
 * Idempotent and non-destructive by default:
 *   - categories: created if missing (existing ones are left as edited)
 *   - articles:   created + PUBLISHED if the (slug, language) is missing;
 *                 existing articles are left alone so platform edits survive.
 *
 *   npm run db:seed:help              # create missing only
 *   npm run db:seed:help -- --update  # also overwrite categories, and update
 *                                     # articles whose fixture content differs
 *                                     # (as a new version — history is kept)
 *
 * Articles go through the same authoring service as the platform console, so
 * each gets a version-1 snapshot and a fresh search vector.
 */
import path from 'node:path';
import { prisma } from '../src/server/db';
import { loadFixtures } from '../src/server/help/fixtures';
import { createArticle, updateArticle, type Actor } from '../src/server/help/authoring';

const ROOT = path.join(__dirname, '..', 'content', 'help');
const ACTOR: Actor = { id: 'system:help-seed', name: 'Help starter content', role: 'SYSTEM' };

async function main() {
  const update = process.argv.includes('--update');
  const { categories, articles } = loadFixtures(ROOT);
  const catIds = new Map<string, string>();
  let catCreated = 0;
  for (const c of categories) {
    const data = { title: c.title, description: c.description ?? null, audience: c.audience, sortOrder: c.sortOrder };
    const existing = await prisma.helpCategory.findUnique({ where: { slug: c.slug } });
    const row = existing
      ? update
        ? await prisma.helpCategory.update({ where: { id: existing.id }, data })
        : existing
      : await prisma.helpCategory.create({ data: { slug: c.slug, ...data } });
    if (!existing) catCreated++;
    catIds.set(c.slug, row.id);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const f of articles) {
    const input = {
      slug: f.slug,
      language: f.language,
      title: f.title,
      summary: f.summary,
      body: f.body,
      audience: f.audience,
      tags: f.tags,
      appArea: f.appArea,
      relatedSlugs: f.relatedSlugs,
      categoryId: catIds.get(f.categorySlug) ?? null,
      sortOrder: f.sortOrder,
    };
    const existing = await prisma.helpArticle.findUnique({ where: { slug_language: { slug: f.slug, language: f.language } } });
    if (!existing) {
      await createArticle(input, ACTOR, { publish: true, note: 'starter content' });
      created++;
    } else if (
      update &&
      (existing.title !== f.title || existing.summary !== f.summary || existing.body !== f.body ||
        existing.appArea !== f.appArea || existing.tags.join() !== f.tags.join() ||
        existing.audience.join() !== f.audience.join() || existing.relatedSlugs.join() !== f.relatedSlugs.join() ||
        existing.categoryId !== input.categoryId)
    ) {
      const { slug: _s, language: _l, ...patch } = input;
      await updateArticle(existing.id, { ...patch, note: 'starter content refresh' }, ACTOR);
      updated++;
    } else {
      skipped++;
    }
  }
  console.log(
    `help seed: categories +${catCreated} (${categories.length} total); articles +${created} created, ${updated} updated, ${skipped} unchanged/kept (${articles.length} fixtures)`
  );
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
