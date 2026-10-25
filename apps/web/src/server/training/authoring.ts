/**
 * Training library v2 — platform authoring: payload validation + the
 * transactional "save module content" used by the editor and the seed script.
 */
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { LESSON_KINDS, TRAINING_AUDIENCES, TRAINING_CATEGORIES } from './types';
import { legacyToLessons, lessonsToLegacyBlocks, lessonsToPlainText, asStringArray } from './content';

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v) || v.startsWith('/'), 'Must be an http(s) URL or a site path');

const hiLesson = z
  .object({
    title: z.string().max(200).optional(),
    body: z.string().max(20000).optional(),
    checklistItems: z.array(z.string().max(300)).max(40).optional(),
  })
  .optional();

export const LessonSchema = z
  .object({
    id: z.string().max(64).optional(),
    kind: z.enum(LESSON_KINDS),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20000).default(''),
    mediaUrl: httpUrl.nullable().optional(),
    checklistItems: z.array(z.string().max(300)).max(40).optional(),
    translations: z.object({ hi: hiLesson }).optional(),
  })
  .superRefine((l, ctx) => {
    if ((l.kind === 'IMAGE' || l.kind === 'VIDEO') && !l.mediaUrl) {
      ctx.addIssue({ code: 'custom', message: `${l.kind === 'IMAGE' ? 'Image' : 'Video'} lessons need a URL`, path: ['mediaUrl'] });
    }
    if (l.kind === 'CHECKLIST' && asStringArray(l.checklistItems).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Checklist lessons need at least one item', path: ['checklistItems'] });
    }
  });

export const QuestionSchema = z
  .object({
    id: z.string().max(64).optional(),
    prompt: z.string().trim().min(3).max(500),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: z.string().max(1000).nullable().optional(),
    translations: z
      .object({
        hi: z
          .object({
            prompt: z.string().max(500).optional(),
            options: z.array(z.string().max(200)).max(6).optional(),
            explanation: z.string().max(1000).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine((q) => q.correctIndex < q.options.length, { message: 'Correct answer must be one of the options', path: ['correctIndex'] });

/** Module settings accepted by create + update (all optional on update). */
export const ModuleSettingsSchema = z.object({
  title: z.string().trim().min(2).max(160),
  summary: z.string().max(500).nullable().optional(),
  category: z.enum(TRAINING_CATEGORIES),
  audience: z.enum(TRAINING_AUDIENCES),
  heroImageUrl: httpUrl.nullable().optional(),
  durationMin: z.number().int().min(1).max(600),
  order: z.number().int().min(0).max(9999),
  isRequired: z.boolean(),
  isActive: z.boolean(),
  blocksShift: z.boolean(),
  passMarkPct: z.number().int().min(0).max(100),
  maxAttempts: z.number().int().min(1).max(50).nullable(),
  retakeCooldownMin: z.number().int().min(0).max(10080),
  dueDays: z.number().int().min(0).max(365),
  translations: z
    .object({ hi: z.object({ title: z.string().max(160).optional(), summary: z.string().max(500).optional() }).optional() })
    .nullable()
    .optional(),
});

export const ModuleContentSchema = ModuleSettingsSchema.partial().extend({
  lessons: z.array(LessonSchema).max(60).optional(),
  questions: z.array(QuestionSchema).max(50).optional(),
  /** Bump the content version → everyone must re-certify. */
  bumpVersion: z.boolean().optional(),
});

export type ModuleContentInput = z.infer<typeof ModuleContentSchema>;

type Tx = Prisma.TransactionClient | PrismaClient;

const cleanTranslations = (t: unknown) => {
  if (!t || typeof t !== 'object') return undefined;
  const hi = (t as any).hi;
  if (!hi || typeof hi !== 'object') return undefined;
  const entries = Object.entries(hi).filter(([, v]) =>
    Array.isArray(v) ? v.some((x) => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim(),
  );
  return entries.length ? { hi: Object.fromEntries(entries) } : undefined;
};

/**
 * Apply settings + (optionally) the full ordered lesson/question set to a
 * module. Lessons/questions are matched by id (ids from another module are
 * ignored → created fresh); rows missing from the payload are deleted. The
 * legacy contentBlocks/contentBody are regenerated so old app builds stay in
 * sync. Must run inside a transaction.
 */
export async function applyModuleContent(tx: Tx, moduleId: string, input: ModuleContentInput) {
  const before = await tx.trainingModule.findUniqueOrThrow({
    where: { id: moduleId },
    include: { lessons: { select: { id: true } }, questions: { select: { id: true } } },
  });

  const data: Prisma.TrainingModuleUpdateInput = {};
  const keys = [
    'title', 'summary', 'category', 'audience', 'heroImageUrl', 'durationMin', 'order', 'isRequired',
    'isActive', 'blocksShift', 'passMarkPct', 'maxAttempts', 'retakeCooldownMin', 'dueDays',
  ] as const;
  for (const k of keys) if (input[k] !== undefined) (data as any)[k] = input[k];
  if (input.translations !== undefined) {
    data.translations = (cleanTranslations(input.translations) ?? null) as any;
  }
  if (input.bumpVersion) {
    data.version = { increment: 1 };
    data.versionPublishedAt = new Date();
  }

  if (input.lessons) {
    const own = new Set(before.lessons.map((l) => l.id));
    const keep = new Set<string>();
    for (const [i, l] of input.lessons.entries()) {
      const row = {
        order: i,
        kind: l.kind,
        title: l.title,
        body: l.body ?? '',
        mediaUrl: l.kind === 'IMAGE' || l.kind === 'VIDEO' ? l.mediaUrl ?? null : null,
        checklistItems: l.kind === 'CHECKLIST' ? asStringArray(l.checklistItems) : undefined,
        translations: (cleanTranslations(l.translations) ?? undefined) as any,
      };
      if (l.id && own.has(l.id)) {
        await tx.trainingLesson.update({
          where: { id: l.id },
          data: { ...row, checklistItems: row.checklistItems ?? ([] as any), translations: row.translations ?? null },
        });
        keep.add(l.id);
      } else {
        const created = await tx.trainingLesson.create({ data: { ...row, moduleId } });
        keep.add(created.id);
      }
    }
    const remove = [...own].filter((id) => !keep.has(id));
    if (remove.length) await tx.trainingLesson.deleteMany({ where: { id: { in: remove } } });
  }

  if (input.questions) {
    const own = new Set(before.questions.map((q) => q.id));
    const keep = new Set<string>();
    for (const [i, q] of input.questions.entries()) {
      const row = {
        order: i,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation?.trim() ? q.explanation : null,
        translations: (cleanTranslations(q.translations) ?? undefined) as any,
      };
      if (q.id && own.has(q.id)) {
        await tx.trainingQuestion.update({ where: { id: q.id }, data: { ...row, translations: row.translations ?? null } });
        keep.add(q.id);
      } else {
        const created = await tx.trainingQuestion.create({ data: { ...row, moduleId } });
        keep.add(created.id);
      }
    }
    const remove = [...own].filter((id) => !keep.has(id));
    if (remove.length) await tx.trainingQuestion.deleteMany({ where: { id: { in: remove } } });
  }

  if (input.lessons || input.questions || input.summary !== undefined) {
    const lessons = await tx.trainingLesson.findMany({ where: { moduleId }, orderBy: { order: 'asc' } });
    const questions = await tx.trainingQuestion.findMany({ where: { moduleId }, orderBy: { order: 'asc' } });
    if (lessons.length > 0) {
      const lessonInputs = lessons.map((l) => ({
        kind: l.kind,
        title: l.title,
        body: l.body,
        mediaUrl: l.mediaUrl,
        checklistItems: asStringArray(l.checklistItems),
      }));
      const questionInputs = questions.map((q) => ({
        prompt: q.prompt,
        options: asStringArray(q.options),
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      }));
      data.contentBlocks = lessonsToLegacyBlocks(lessonInputs, questionInputs) as any;
      data.contentVersion = 2;
      data.contentBody = lessonsToPlainText(
        input.summary !== undefined ? input.summary ?? null : before.summary,
        lessonInputs,
      );
    }
  }

  return tx.trainingModule.update({ where: { id: moduleId }, data });
}

/** Full editor payload for one module (legacy modules are converted on the fly, unsaved). */
export async function loadModuleForEditor(tx: Tx, moduleId: string) {
  const m = await tx.trainingModule.findUnique({
    where: { id: moduleId },
    include: { lessons: { orderBy: { order: 'asc' } }, questions: { orderBy: { order: 'asc' } } },
  });
  if (!m) return null;
  let lessons = m.lessons.map((l) => ({
    id: l.id as string | undefined,
    kind: l.kind,
    title: l.title,
    body: l.body,
    mediaUrl: l.mediaUrl,
    checklistItems: asStringArray(l.checklistItems),
    translations: (l.translations ?? undefined) as any,
  }));
  let questions = m.questions.map((q) => ({
    id: q.id as string | undefined,
    prompt: q.prompt,
    options: asStringArray(q.options),
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    translations: (q.translations ?? undefined) as any,
  }));
  let convertedFromLegacy = false;
  if (lessons.length === 0) {
    const legacy = legacyToLessons(m);
    if (legacy.lessons.length) {
      convertedFromLegacy = true;
      lessons = legacy.lessons.map((l) => ({ ...l, id: undefined, mediaUrl: l.mediaUrl ?? null, checklistItems: l.checklistItems ?? [], translations: undefined }));
      if (questions.length === 0) {
        questions = legacy.questions.map((q) => ({ ...q, id: undefined, explanation: q.explanation ?? null, translations: undefined }));
      }
    }
  }
  return {
    id: m.id,
    slug: m.slug,
    title: m.title,
    summary: m.summary,
    category: m.category,
    audience: m.audience,
    heroImageUrl: m.heroImageUrl,
    durationMin: m.durationMin,
    order: m.order,
    isRequired: m.isRequired,
    isActive: m.isActive,
    blocksShift: m.blocksShift,
    passMarkPct: m.passMarkPct,
    maxAttempts: m.maxAttempts,
    retakeCooldownMin: m.retakeCooldownMin,
    dueDays: m.dueDays,
    version: m.version,
    versionPublishedAt: m.versionPublishedAt.toISOString(),
    translations: (m.translations ?? null) as any,
    lessons,
    questions,
    convertedFromLegacy,
  };
}

export type EditorModule = NonNullable<Awaited<ReturnType<typeof loadModuleForEditor>>>;
