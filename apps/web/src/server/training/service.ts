/**
 * Training library v2 — learner-side service (riders + restaurant staff).
 *
 * Routes stay thin: they resolve the caller to a `Learner` and call these.
 * Every read is scoped to modules the learner's role may see (audience) and to
 * the learner's own progress rows.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { parseContentBlocks } from '@/server/training-cms';
import {
  availableLanguages,
  legacyToLessons,
  localizeLesson,
  localizeModuleText,
  localizeQuestion,
  localizedExplanation,
  asStringArray,
} from './content';
import {
  attemptEligibility,
  computeModuleStatus,
  gradeQuiz,
  newCertificateCode,
  shouldIssueCertificate,
  type ModuleStatus,
} from './grading';
import type { TrainingAudience, TrainingLanguage } from './types';

export interface Learner {
  id: string;
  role: Role | string;
  createdAt: Date;
}

export function primaryAudience(role: string): TrainingAudience | null {
  if (role === 'RIDER') return 'RIDER';
  if (role === 'KITCHEN') return 'KITCHEN';
  if (role === 'ADMIN') return 'RESTAURANT_ADMIN';
  return null;
}

/** Restaurant admins also see kitchen modules (optional for them). */
export function visibleAudiences(role: string): TrainingAudience[] {
  const p = primaryAudience(role);
  if (!p) return [];
  return p === 'RESTAURANT_ADMIN' ? ['RESTAURANT_ADMIN', 'KITCHEN'] : [p];
}

export function isRequiredFor(mod: { isRequired: boolean; audience: string }, role: string): boolean {
  return mod.isRequired && mod.audience === primaryAudience(role);
}

// ─── Legacy forward-migration ────────────────────────────────────────────────

/**
 * Pre-v2 modules have content only in contentBlocks/contentBody/quizQuestions.
 * The first time one is used, materialize it into real lesson + question rows
 * (lesson completions need a FK). Idempotent and race-safe (advisory lock).
 */
export async function ensureLessons(moduleId: string): Promise<void> {
  const count = await prisma.trainingLesson.count({ where: { moduleId } });
  if (count > 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${moduleId}))::text`;
    if ((await tx.trainingLesson.count({ where: { moduleId } })) > 0) return;
    const mod = await tx.trainingModule.findUnique({
      where: { id: moduleId },
      select: {
        title: true,
        contentBlocks: true,
        contentBody: true,
        quizQuestions: true,
        _count: { select: { questions: true } },
      },
    });
    if (!mod) return;
    const { lessons, questions } = legacyToLessons(mod);
    if (lessons.length === 0) return;
    await tx.trainingLesson.createMany({
      data: lessons.map((l, i) => ({
        moduleId,
        order: i,
        kind: l.kind,
        title: l.title.slice(0, 200),
        body: l.body,
        mediaUrl: l.mediaUrl ?? null,
        checklistItems: l.checklistItems?.length ? l.checklistItems : undefined,
      })),
    });
    if (mod._count.questions === 0 && questions.length > 0) {
      await tx.trainingQuestion.createMany({
        data: questions.map((q, i) => ({
          moduleId,
          order: i,
          prompt: q.prompt,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation ?? null,
        })),
      });
    }
  });
}

// ─── Loading + status ────────────────────────────────────────────────────────

const moduleSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  category: true,
  audience: true,
  durationMin: true,
  order: true,
  isRequired: true,
  isActive: true,
  blocksShift: true,
  version: true,
  versionPublishedAt: true,
  translations: true,
  passMarkPct: true,
  maxAttempts: true,
  retakeCooldownMin: true,
  dueDays: true,
  heroImageUrl: true,
  lessons: { select: { id: true }, orderBy: { order: 'asc' as const } },
  _count: { select: { questions: true } },
} satisfies Prisma.TrainingModuleSelect;

type ModuleRow = Prisma.TrainingModuleGetPayload<{ select: typeof moduleSelect }>;

async function loadProgress(userId: string, moduleIds: string[]) {
  const [completions, attempts, certificates] = await Promise.all([
    prisma.trainingLessonCompletion.findMany({
      where: { userId, moduleId: { in: moduleIds } },
      select: { moduleId: true, lessonId: true, moduleVersion: true },
    }),
    prisma.trainingQuizAttempt.findMany({
      where: { userId, moduleId: { in: moduleIds } },
      select: { moduleId: true, moduleVersion: true, passed: true, scorePct: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.trainingCertificate.findMany({
      where: { userId, moduleId: { in: moduleIds } },
      select: { moduleId: true, moduleVersion: true, issuedAt: true, scorePct: true, code: true },
    }),
  ]);
  const by = <T extends { moduleId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.moduleId, [...(m.get(r.moduleId) ?? []), r]);
    return m;
  };
  return { completions: by(completions), attempts: by(attempts), certificates: by(certificates) };
}

function statusFor(
  mod: ModuleRow,
  learner: Learner,
  progress: Awaited<ReturnType<typeof loadProgress>>,
  now: Date,
): ModuleStatus {
  return computeModuleStatus({
    version: mod.version,
    versionPublishedAt: mod.versionPublishedAt,
    lessonIds: mod.lessons.map((l) => l.id),
    completions: progress.completions.get(mod.id) ?? [],
    questionCount: mod._count.questions,
    attempts: progress.attempts.get(mod.id) ?? [],
    certificates: progress.certificates.get(mod.id) ?? [],
    isRequired: isRequiredFor(mod, String(learner.role)),
    dueDays: mod.dueDays,
    learnerSince: learner.createdAt,
    now,
  });
}

function summarize(mod: ModuleRow, learner: Learner, status: ModuleStatus, lang: TrainingLanguage) {
  const text = localizeModuleText(mod, lang);
  return {
    id: mod.id,
    slug: mod.slug,
    title: text.title,
    summary: text.summary,
    category: mod.category,
    audience: mod.audience,
    durationMin: mod.durationMin,
    order: mod.order,
    isRequired: isRequiredFor(mod, String(learner.role)),
    blocksShift: mod.blocksShift,
    version: mod.version,
    languages: availableLanguages(mod.translations),
    lessonsCount: mod.lessons.length,
    questionCount: mod._count.questions,
    passMarkPct: mod.passMarkPct,
    heroImageUrl: mod.heroImageUrl,
    // Legacy fields — pre-v2 rider-native builds read these.
    completed: status.certified,
    completedAt: status.certificate?.issuedAt.toISOString() ?? null,
    quizScore: status.certificate?.scorePct ?? status.bestScorePct,
    status: {
      state: status.state,
      progressPct: status.progressPct,
      lessonsDone: status.lessonsDone,
      lessonsTotal: status.lessonsTotal,
      needsRecert: status.needsRecert,
      overdue: status.overdue,
      dueAt: status.dueAt?.toISOString() ?? null,
      certificateCode: status.certificate?.code ?? null,
    },
  };
}

export type LearnerModuleSummary = ReturnType<typeof summarize>;

export async function listLearnerModules(learner: Learner, lang: TrainingLanguage) {
  const audiences = visibleAudiences(String(learner.role));
  const where = { isActive: true, audience: { in: audiences } };
  let mods = await prisma.trainingModule.findMany({
    where,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: moduleSelect,
  });
  const legacy = mods.filter((m) => m.lessons.length === 0);
  if (legacy.length > 0) {
    for (const m of legacy) await ensureLessons(m.id);
    mods = await prisma.trainingModule.findMany({
      where,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: moduleSelect,
    });
  }
  const progress = await loadProgress(learner.id, mods.map((m) => m.id));
  const now = new Date();
  const modules = mods.map((m) => summarize(m, learner, statusFor(m, learner, progress, now), lang));
  const required = modules.filter((m) => m.isRequired);
  return {
    modules,
    completedCount: modules.filter((m) => m.completed).length,
    totalCount: modules.length,
    requiredRemaining: required.filter((m) => !m.completed).length,
    requiredOverdue: required.filter((m) => m.status.overdue).length,
    recertRequired: required.filter((m) => m.status.needsRecert).length,
  };
}

async function loadVisibleModule(learner: Learner, moduleId: string) {
  const audiences = visibleAudiences(String(learner.role));
  if (audiences.length === 0) return null;
  const exists = await prisma.trainingModule.findFirst({
    where: { id: moduleId, isActive: true, audience: { in: audiences } },
    select: { id: true },
  });
  if (!exists) return null;
  await ensureLessons(moduleId);
  return prisma.trainingModule.findUnique({ where: { id: moduleId }, select: moduleSelect });
}

export async function getLearnerModule(learner: Learner, moduleId: string, lang: TrainingLanguage) {
  const mod = await loadVisibleModule(learner, moduleId);
  if (!mod) return null;
  const [full, progress] = await Promise.all([
    prisma.trainingModule.findUnique({
      where: { id: moduleId },
      select: {
        contentBody: true,
        contentBlocks: true,
        contentVersion: true,
        quizQuestions: true,
        lessons: { orderBy: { order: 'asc' } },
        questions: { orderBy: { order: 'asc' } },
      },
    }),
    loadProgress(learner.id, [moduleId]),
  ]);
  if (!full) return null;
  const now = new Date();
  const status = statusFor(mod, learner, progress, now);
  const currentAttempts = (progress.attempts.get(moduleId) ?? []).filter((a) => a.moduleVersion === mod.version);
  const eligibility = attemptEligibility({
    attempts: currentAttempts,
    maxAttempts: mod.maxAttempts,
    retakeCooldownMin: mod.retakeCooldownMin,
    lessonsComplete: status.lessonsDone >= status.lessonsTotal,
    now,
  });
  const last = currentAttempts[currentAttempts.length - 1] ?? null;
  return {
    ...summarize(mod, learner, status, lang),
    lessons: full.lessons.map((l) => localizeLesson(l, lang)),
    completedLessonIds: status.completedLessonIds,
    quiz:
      full.questions.length === 0
        ? null
        : {
            questions: full.questions.map((q) => localizeQuestion(q, lang)),
            passMarkPct: mod.passMarkPct,
            maxAttempts: mod.maxAttempts,
            retakeCooldownMin: mod.retakeCooldownMin,
            eligibility: serializeEligibility(eligibility),
            lastAttempt: last
              ? { scorePct: last.scorePct, passed: last.passed, createdAt: last.createdAt.toISOString() }
              : null,
          },
    // Legacy fields for pre-v2 rider-native builds.
    contentBody: full.contentBody,
    contentBlocks: parseContentBlocks(full.contentBlocks),
    contentVersion: full.contentVersion ?? 1,
    quizQuestions: full.quizQuestions ?? null,
    progress: {
      completed: status.certified,
      completedAt: status.certificate?.issuedAt.toISOString() ?? null,
      quizScore: status.certificate?.scorePct ?? status.bestScorePct,
    },
  };
}

function serializeEligibility(e: ReturnType<typeof attemptEligibility>) {
  return { ...e, retryAt: e.retryAt?.toISOString() ?? null };
}

// ─── Certificates ────────────────────────────────────────────────────────────

async function issueCertificate(learner: Learner, mod: { id: string; version: number }, scorePct: number | null) {
  const existing = await prisma.trainingCertificate.findUnique({
    where: { userId_moduleId_moduleVersion: { userId: learner.id, moduleId: mod.id, moduleVersion: mod.version } },
  });
  if (existing) return existing;
  let cert;
  for (let i = 0; ; i++) {
    try {
      cert = await prisma.trainingCertificate.create({
        data: { userId: learner.id, moduleId: mod.id, moduleVersion: mod.version, scorePct, code: newCertificateCode() },
      });
      break;
    } catch (e: any) {
      // P2002 on (userId, moduleId, moduleVersion) = a concurrent request won; on code = retry.
      if (e?.code !== 'P2002' || i >= 3) throw e;
      const raced = await prisma.trainingCertificate.findUnique({
        where: { userId_moduleId_moduleVersion: { userId: learner.id, moduleId: mod.id, moduleVersion: mod.version } },
      });
      if (raced) return raced;
    }
  }
  // Keep the legacy per-rider progress row in step (old stats + old app builds).
  if (learner.role === 'RIDER') {
    const profile = await prisma.riderProfile.findUnique({ where: { userId: learner.id }, select: { id: true } });
    if (profile) {
      await prisma.riderTrainingProgress.upsert({
        where: { moduleId_riderId: { moduleId: mod.id, riderId: profile.id } },
        create: { moduleId: mod.id, riderId: profile.id, completed: true, completedAt: cert.issuedAt, quizScore: scorePct },
        update: { completed: true, completedAt: cert.issuedAt, ...(scorePct !== null ? { quizScore: scorePct } : {}) },
      });
    }
  }
  return cert;
}

export type TrainingActionError =
  | { error: string; code: 'training/not_found'; status: 404 }
  | { error: string; code: 'training/not_allowed'; status: 409; reason: string; retryAt?: string | null };

const notFound = (): TrainingActionError => ({ error: 'Training module not found.', code: 'training/not_found', status: 404 });

export async function completeLesson(learner: Learner, moduleId: string, lessonId: string, lang: TrainingLanguage) {
  const mod = await loadVisibleModule(learner, moduleId);
  if (!mod || !mod.lessons.some((l) => l.id === lessonId)) return notFound();
  await prisma.trainingLessonCompletion.upsert({
    where: { userId_lessonId: { userId: learner.id, lessonId } },
    create: { userId: learner.id, moduleId, lessonId, moduleVersion: mod.version },
    update: { moduleVersion: mod.version, completedAt: new Date() },
  });
  const progress = await loadProgress(learner.id, [moduleId]);
  const status = statusFor(mod, learner, progress, new Date());
  if (shouldIssueCertificate(status, { questionCount: mod._count.questions, passedAttempt: false })) {
    await issueCertificate(learner, mod, null);
  }
  const fresh = await getLearnerModule(learner, moduleId, lang);
  return { module: fresh };
}

export async function submitQuiz(
  learner: Learner,
  moduleId: string,
  answers: Record<string, unknown>,
  lang: TrainingLanguage,
) {
  const mod = await loadVisibleModule(learner, moduleId);
  if (!mod) return notFound();
  const questions = await prisma.trainingQuestion.findMany({ where: { moduleId }, orderBy: { order: 'asc' } });
  if (questions.length === 0) return notFound();
  const progress = await loadProgress(learner.id, [moduleId]);
  const now = new Date();
  const status = statusFor(mod, learner, progress, now);
  const currentAttempts = (progress.attempts.get(moduleId) ?? []).filter((a) => a.moduleVersion === mod.version);
  const elig = attemptEligibility({
    attempts: currentAttempts,
    maxAttempts: mod.maxAttempts,
    retakeCooldownMin: mod.retakeCooldownMin,
    lessonsComplete: status.lessonsDone >= status.lessonsTotal,
    now,
  });
  if (!elig.allowed) {
    const messages: Record<string, string> = {
      already_passed: 'You have already passed this quiz.',
      lessons_incomplete: 'Finish every lesson before taking the quiz.',
      max_attempts: 'No quiz attempts left for this version. Contact Flavrly Support to reset your attempts.',
      cooldown: 'Please review the lessons and try again a little later.',
    };
    return {
      error: messages[elig.reason ?? 'cooldown'],
      code: 'training/not_allowed' as const,
      status: 409 as const,
      reason: elig.reason ?? 'cooldown',
      retryAt: elig.retryAt?.toISOString() ?? null,
    };
  }

  const grade = gradeQuiz(questions, answers, mod.passMarkPct);
  const cleanAnswers: Record<string, number> = {};
  for (const r of grade.results) if (r.chosenIndex !== null) cleanAnswers[r.questionId] = r.chosenIndex;
  await prisma.trainingQuizAttempt.create({
    data: {
      userId: learner.id,
      moduleId,
      moduleVersion: mod.version,
      scorePct: grade.scorePct,
      correctCount: grade.correctCount,
      totalCount: grade.totalCount,
      passed: grade.passed,
      answers: cleanAnswers,
      source: 'app',
    },
  });
  if (grade.passed) await issueCertificate(learner, mod, grade.scorePct);

  const byId = new Map(questions.map((q) => [q.id, q]));
  const fresh = await getLearnerModule(learner, moduleId, lang);
  return {
    result: {
      scorePct: grade.scorePct,
      correctCount: grade.correctCount,
      totalCount: grade.totalCount,
      passed: grade.passed,
      passMarkPct: mod.passMarkPct,
      // Correct answers are only revealed once the learner has passed.
      questions: grade.results.map((r) => {
        const q = byId.get(r.questionId)!;
        return {
          questionId: r.questionId,
          chosenIndex: r.chosenIndex,
          correct: r.correct,
          correctIndex: grade.passed ? q.correctIndex : null,
          explanation: grade.passed || r.correct ? localizedExplanation(q, lang) : null,
        };
      }),
    },
    module: fresh,
  };
}

/**
 * Pre-v2 rider-native builds grade their inline quiz locally and POST only a
 * score. Accept it (recorded as a `legacy` attempt) under the same pass mark
 * and retake rules, then complete every lesson + issue the certificate.
 */
export async function legacyComplete(learner: Learner, moduleId: string, quizScore: number | null) {
  const mod = await loadVisibleModule(learner, moduleId);
  if (!mod) return notFound();
  const now = new Date();
  let scorePct: number | null = null;
  if (mod._count.questions > 0) {
    if (quizScore === null) {
      return { error: 'Answer the quiz to complete this module.', code: 'training/not_allowed' as const, status: 409 as const, reason: 'quiz_required' };
    }
    const progress = await loadProgress(learner.id, [moduleId]);
    const currentAttempts = (progress.attempts.get(moduleId) ?? []).filter((a) => a.moduleVersion === mod.version);
    const elig = attemptEligibility({
      attempts: currentAttempts,
      maxAttempts: mod.maxAttempts,
      retakeCooldownMin: mod.retakeCooldownMin,
      lessonsComplete: true,
      now,
    });
    if (!elig.allowed && elig.reason !== 'already_passed') {
      return {
        error: elig.reason === 'max_attempts'
          ? 'No quiz attempts left. Contact Flavrly Support.'
          : 'Please review the lesson and try again a little later.',
        code: 'training/not_allowed' as const,
        status: 409 as const,
        reason: elig.reason ?? 'cooldown',
        retryAt: elig.retryAt?.toISOString() ?? null,
      };
    }
    scorePct = Math.max(0, Math.min(100, Math.round(quizScore)));
    const passed = scorePct >= mod.passMarkPct;
    if (elig.reason !== 'already_passed') {
      await prisma.trainingQuizAttempt.create({
        data: {
          userId: learner.id, moduleId, moduleVersion: mod.version, scorePct,
          correctCount: Math.round((scorePct / 100) * mod._count.questions), totalCount: mod._count.questions,
          passed, source: 'legacy',
        },
      });
    }
    if (!passed && elig.reason !== 'already_passed') {
      return {
        error: `You scored ${scorePct}%. The pass mark is ${mod.passMarkPct}%. Review the lesson and try again.`,
        code: 'training/not_allowed' as const, status: 409 as const, reason: 'below_pass_mark',
      };
    }
  }
  for (const l of mod.lessons) {
    await prisma.trainingLessonCompletion.upsert({
      where: { userId_lessonId: { userId: learner.id, lessonId: l.id } },
      create: { userId: learner.id, moduleId, lessonId: l.id, moduleVersion: mod.version },
      update: { moduleVersion: mod.version },
    });
  }
  const cert = await issueCertificate(learner, mod, scorePct);
  return { completed: true, completedAt: cert.issuedAt.toISOString(), quizScore: cert.scorePct };
}

export async function listCertificates(learner: Learner, lang: TrainingLanguage) {
  const certs = await prisma.trainingCertificate.findMany({
    where: { userId: learner.id },
    orderBy: { issuedAt: 'desc' },
    include: { module: { select: { id: true, title: true, summary: true, translations: true, version: true, audience: true, isActive: true } } },
  });
  return {
    certificates: certs.map((c) => ({
      id: c.id,
      code: c.code,
      moduleId: c.moduleId,
      moduleTitle: localizeModuleText(c.module, lang).title,
      moduleVersion: c.moduleVersion,
      currentVersion: c.module.version,
      isCurrent: c.moduleVersion === c.module.version,
      scorePct: c.scorePct,
      issuedAt: c.issuedAt.toISOString(),
    })),
  };
}

// ─── Gaps + gating ───────────────────────────────────────────────────────────

export interface RequiredGap {
  moduleId: string;
  title: string;
  overdue: boolean;
  needsRecert: boolean;
}

/** Required, active modules of `audience` that each user lacks a CURRENT certificate for. */
export async function requiredGapsForUsers(
  users: { id: string; since: Date }[],
  audience: TrainingAudience,
  opts: { onlyBlocksShift?: boolean; now?: Date } = {},
): Promise<Map<string, RequiredGap[]>> {
  const out = new Map<string, RequiredGap[]>();
  if (users.length === 0) return out;
  const modules = await prisma.trainingModule.findMany({
    where: { isActive: true, isRequired: true, audience, ...(opts.onlyBlocksShift ? { blocksShift: true } : {}) },
    select: { id: true, title: true, version: true, versionPublishedAt: true, dueDays: true },
  });
  if (modules.length === 0) return out;
  const certs = await prisma.trainingCertificate.findMany({
    where: { userId: { in: users.map((u) => u.id) }, moduleId: { in: modules.map((m) => m.id) } },
    select: { userId: true, moduleId: true, moduleVersion: true },
  });
  const held = new Map<string, number[]>();
  for (const c of certs) {
    const k = `${c.userId}:${c.moduleId}`;
    held.set(k, [...(held.get(k) ?? []), c.moduleVersion]);
  }
  const now = opts.now ?? new Date();
  for (const u of users) {
    const gaps: RequiredGap[] = [];
    for (const m of modules) {
      const versions = held.get(`${u.id}:${m.id}`) ?? [];
      if (versions.includes(m.version)) continue;
      const due = Math.max(m.versionPublishedAt.getTime(), u.since.getTime()) + m.dueDays * 86_400_000;
      gaps.push({ moduleId: m.id, title: m.title, overdue: now.getTime() > due, needsRecert: versions.length > 0 });
    }
    if (gaps.length) out.set(u.id, gaps);
  }
  return out;
}

/** Safety modules that block a rider from going online (empty when the platform gate is off). */
export async function shiftGateBlockers(user: { id: string; createdAt: Date }): Promise<RequiredGap[]> {
  const { getTrainingShiftGate } = await import('@/server/platform-settings');
  if (!(await getTrainingShiftGate())) return [];
  const gaps = await requiredGapsForUsers([{ id: user.id, since: user.createdAt }], 'RIDER', { onlyBlocksShift: true });
  return gaps.get(user.id) ?? [];
}

export { asStringArray };

export type LearnerModuleDetail = NonNullable<Awaited<ReturnType<typeof getLearnerModule>>>;
export type LearnerLibrary = Awaited<ReturnType<typeof listLearnerModules>>;
export type LearnerCertificates = Awaited<ReturnType<typeof listCertificates>>;
type SubmitOutcome = Awaited<ReturnType<typeof submitQuiz>>;
export type QuizSubmitResult = Extract<SubmitOutcome, { result: unknown }>['result'];
