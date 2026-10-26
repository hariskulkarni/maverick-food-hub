/**
 * Training service flows over a tiny in-memory prisma fake: audience
 * visibility, lesson completion, server-side grading, certificates, retake
 * rules, version-bump re-certification, legacy (pre-v2 app) completion, gaps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  const s = {
    modules: [] as Row[],
    lessons: [] as Row[],
    questions: [] as Row[],
    completions: [] as Row[],
    attempts: [] as Row[],
    certs: [] as Row[],
    riderProgress: [] as Row[],
    riderProfiles: [] as Row[],
  };
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const inList = (v: any, cond: any) => (cond && typeof cond === 'object' && 'in' in cond ? cond.in.includes(v) : cond === undefined || v === cond);
  const moduleView = (m: Row) => ({
    ...m,
    lessons: s.lessons.filter((l) => l.moduleId === m.id).sort((a, b) => a.order - b.order),
    questions: s.questions.filter((q) => q.moduleId === m.id).sort((a, b) => a.order - b.order),
    _count: { questions: s.questions.filter((q) => q.moduleId === m.id).length, lessons: s.lessons.filter((l) => l.moduleId === m.id).length },
  });
  const matchModule = (m: Row, w: any = {}) =>
    (w.id === undefined || m.id === w.id) &&
    (w.isActive === undefined || m.isActive === w.isActive) &&
    (w.isRequired === undefined || m.isRequired === w.isRequired) &&
    (w.blocksShift === undefined || m.blocksShift === w.blocksShift) &&
    inList(m.audience, w.audience);
  const byUserModule = (rows: Row[], w: any) => rows.filter((r) => inList(r.userId, w.userId) && inList(r.moduleId, w.moduleId));
  const prisma: any = {
    trainingModule: {
      findFirst: async ({ where }: any) => s.modules.find((m) => matchModule(m, where)) ?? null,
      findUnique: async ({ where }: any) => {
        const m = s.modules.find((x) => x.id === where.id);
        return m ? moduleView(m) : null;
      },
      findMany: async ({ where }: any) => s.modules.filter((m) => matchModule(m, where)).sort((a, b) => a.order - b.order).map(moduleView),
    },
    trainingLesson: { count: async ({ where }: any) => s.lessons.filter((l) => l.moduleId === where.moduleId).length },
    trainingQuestion: { findMany: async ({ where }: any) => s.questions.filter((q) => q.moduleId === where.moduleId).sort((a, b) => a.order - b.order) },
    trainingLessonCompletion: {
      findMany: async ({ where }: any) => byUserModule(s.completions, where),
      upsert: async ({ where, create, update }: any) => {
        const k = where.userId_lessonId;
        const ex = s.completions.find((c) => c.userId === k.userId && c.lessonId === k.lessonId);
        if (ex) return Object.assign(ex, update);
        const row = { id: id('c'), completedAt: new Date(), ...create };
        s.completions.push(row);
        return row;
      },
    },
    trainingQuizAttempt: {
      findMany: async ({ where }: any) => byUserModule(s.attempts, where),
      create: async ({ data }: any) => {
        const row = { id: id('a'), createdAt: new Date(), ...data };
        s.attempts.push(row);
        return row;
      },
    },
    trainingCertificate: {
      findMany: async ({ where }: any) => byUserModule(s.certs, where),
      findUnique: async ({ where }: any) => {
        const k = where.userId_moduleId_moduleVersion;
        return s.certs.find((c) => c.userId === k.userId && c.moduleId === k.moduleId && c.moduleVersion === k.moduleVersion) ?? null;
      },
      create: async ({ data }: any) => {
        const row = { id: id('cert'), issuedAt: new Date(), ...data };
        s.certs.push(row);
        return row;
      },
    },
    riderProfile: { findUnique: async ({ where }: any) => s.riderProfiles.find((r) => r.userId === where.userId) ?? null },
    riderTrainingProgress: {
      upsert: async ({ create }: any) => {
        s.riderProgress.push(create);
        return create;
      },
    },
  };
  return { s, prisma, id };
});

vi.mock('@/server/db', () => ({ prisma: db.prisma }));
vi.mock('@/server/platform-settings', () => ({ getTrainingShiftGate: vi.fn(async () => true) }));

import {
  completeLesson,
  getLearnerModule,
  legacyComplete,
  listLearnerModules,
  requiredGapsForUsers,
  shiftGateBlockers,
  submitQuiz,
  visibleAudiences,
} from '@/server/training/service';
import { getTrainingShiftGate } from '@/server/platform-settings';

const rider = { id: 'u_rider', role: 'RIDER', createdAt: new Date('2026-10-01') };
const kitchen = { id: 'u_kitchen', role: 'KITCHEN', createdAt: new Date('2026-10-01') };
const admin = { id: 'u_admin', role: 'ADMIN', createdAt: new Date('2026-10-01') };

function addModule(over: Record<string, any> = {}) {
  const m = {
    id: db.id('m'), slug: null, title: 'Road safety', summary: 'Stay safe', category: 'SAFETY', audience: 'RIDER',
    durationMin: 10, order: 1, isRequired: true, isActive: true, blocksShift: true, version: 1,
    versionPublishedAt: new Date('2026-10-01'), translations: null, passMarkPct: 80, maxAttempts: null,
    retakeCooldownMin: 0, dueDays: 7, heroImageUrl: null, contentBody: 'x', contentBlocks: null, contentVersion: 2, quizQuestions: null,
    ...over,
  };
  db.s.modules.push(m);
  for (let i = 0; i < 2; i++) db.s.lessons.push({ id: `${m.id}_l${i}`, moduleId: m.id, order: i, kind: 'TEXT', title: `L${i}`, body: 'b', mediaUrl: null, checklistItems: null, translations: null });
  for (let i = 0; i < (over.noQuiz ? 0 : 5); i++) {
    db.s.questions.push({ id: `${m.id}_q${i}`, moduleId: m.id, order: i, prompt: `Q${i}`, options: ['a', 'b', 'c'], correctIndex: i % 3, explanation: `E${i}`, translations: null });
  }
  return m;
}

const allRight = (m: any) => Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`${m.id}_q${i}`, i % 3]));

beforeEach(() => {
  for (const k of Object.keys(db.s) as (keyof typeof db.s)[]) db.s[k].length = 0;
  db.s.riderProfiles.push({ id: 'rp1', userId: 'u_rider' });
});

describe('audience visibility', () => {
  it('maps roles to audiences', () => {
    expect(visibleAudiences('RIDER')).toEqual(['RIDER']);
    expect(visibleAudiences('KITCHEN')).toEqual(['KITCHEN']);
    expect(visibleAudiences('ADMIN')).toEqual(['RESTAURANT_ADMIN', 'KITCHEN']);
    expect(visibleAudiences('CUSTOMER')).toEqual([]);
    expect(visibleAudiences('SUPER_ADMIN')).toEqual([]);
  });

  it('a kitchen user cannot open a rider module; inactive modules are hidden', async () => {
    const m = addModule();
    const draft = addModule({ isActive: false });
    expect(await getLearnerModule(kitchen, m.id, 'en')).toBeNull();
    expect(await getLearnerModule(rider, draft.id, 'en')).toBeNull();
    expect(await getLearnerModule(rider, m.id, 'en')).not.toBeNull();
  });

  it('kitchen modules are required for kitchen staff but optional for admins', async () => {
    addModule({ audience: 'KITCHEN', title: 'KOT' });
    const k = await listLearnerModules(kitchen, 'en');
    const a = await listLearnerModules(admin, 'en');
    expect(k.modules[0].isRequired).toBe(true);
    expect(a.modules[0].isRequired).toBe(false);
    expect(a.requiredRemaining).toBe(0);
  });
});

describe('learning flow', () => {
  it('quiz is locked until lessons are done; answers are never sent to the learner', async () => {
    const m = addModule();
    const detail = await getLearnerModule(rider, m.id, 'en');
    expect(JSON.stringify(detail!.quiz!.questions)).not.toContain('correctIndex');
    expect(detail!.quiz!.eligibility).toMatchObject({ allowed: false, reason: 'lessons_incomplete' });
    const early = await submitQuiz(rider, m.id, allRight(m), 'en');
    expect(early).toMatchObject({ status: 409, reason: 'lessons_incomplete' });
  });

  it('failing records an attempt without a certificate and hides correct answers', async () => {
    const m = addModule();
    for (const l of ['l0', 'l1']) await completeLesson(rider, m.id, `${m.id}_${l}`, 'en');
    const res: any = await submitQuiz(rider, m.id, { [`${m.id}_q0`]: 0 }, 'en');
    expect(res.result).toMatchObject({ scorePct: 20, passed: false });
    expect(res.result.questions.every((q: any) => q.correctIndex === null)).toBe(true);
    expect(db.s.certs).toHaveLength(0);
    expect(db.s.attempts).toHaveLength(1);
  });

  it('passing issues one certificate for the current version and syncs legacy rider progress', async () => {
    const m = addModule();
    for (const l of ['l0', 'l1']) await completeLesson(rider, m.id, `${m.id}_${l}`, 'en');
    const res: any = await submitQuiz(rider, m.id, allRight(m), 'en');
    expect(res.result).toMatchObject({ scorePct: 100, passed: true });
    expect(res.result.questions[0].correctIndex).toBe(0);
    expect(res.module.status.state).toBe('CERTIFIED');
    expect(db.s.certs).toHaveLength(1);
    expect(db.s.certs[0]).toMatchObject({ userId: 'u_rider', moduleVersion: 1, scorePct: 100 });
    expect(db.s.riderProgress[0]).toMatchObject({ riderId: 'rp1', completed: true });
    const again = await submitQuiz(rider, m.id, allRight(m), 'en');
    expect(again).toMatchObject({ status: 409, reason: 'already_passed' });
  });

  it('honours the retake cooldown', async () => {
    const m = addModule({ retakeCooldownMin: 10 });
    for (const l of ['l0', 'l1']) await completeLesson(rider, m.id, `${m.id}_${l}`, 'en');
    await submitQuiz(rider, m.id, {}, 'en');
    const second = await submitQuiz(rider, m.id, allRight(m), 'en');
    expect(second).toMatchObject({ status: 409, reason: 'cooldown' });
    expect((second as any).retryAt).toBeTruthy();
  });

  it('a module without a quiz certifies when the last lesson is done', async () => {
    const m = addModule({ noQuiz: true });
    await completeLesson(rider, m.id, `${m.id}_l0`, 'en');
    expect(db.s.certs).toHaveLength(0);
    const r: any = await completeLesson(rider, m.id, `${m.id}_l1`, 'en');
    expect(r.module.status.state).toBe('CERTIFIED');
  });

  it('rejects a lesson id from another module', async () => {
    const a = addModule();
    const b = addModule();
    expect(await completeLesson(rider, a.id, `${b.id}_l0`, 'en')).toMatchObject({ status: 404 });
  });
});

describe('re-certification', () => {
  it('a version bump flags the learner until they pass the new version', async () => {
    const m = addModule();
    for (const l of ['l0', 'l1']) await completeLesson(rider, m.id, `${m.id}_${l}`, 'en');
    await submitQuiz(rider, m.id, allRight(m), 'en');
    m.version = 2;
    m.versionPublishedAt = new Date();
    const list = await listLearnerModules(rider, 'en');
    expect(list.modules[0]).toMatchObject({ completed: false });
    expect(list.modules[0].status).toMatchObject({ state: 'RECERT_REQUIRED', needsRecert: true, lessonsDone: 0 });
    expect(list.recertRequired).toBe(1);
    const gaps = await requiredGapsForUsers([{ id: rider.id, since: rider.createdAt }], 'RIDER');
    expect(gaps.get(rider.id)).toEqual([expect.objectContaining({ moduleId: m.id, needsRecert: true })]);
  });
});

describe('legacy completion (pre-v2 rider app)', () => {
  it('needs a passing score when the module has a quiz', async () => {
    const m = addModule();
    expect(await legacyComplete(rider, m.id, null)).toMatchObject({ status: 409, reason: 'quiz_required' });
    expect(await legacyComplete(rider, m.id, 40)).toMatchObject({ status: 409, reason: 'below_pass_mark' });
    expect(db.s.attempts[0]).toMatchObject({ source: 'legacy', passed: false });
    const ok: any = await legacyComplete(rider, m.id, 100);
    expect(ok).toMatchObject({ completed: true, quizScore: 100 });
    expect(db.s.completions).toHaveLength(2);
  });
});

describe('shift gate', () => {
  it('lists missing shift-blocking modules only when the platform gate is on', async () => {
    const m = addModule();
    addModule({ blocksShift: false, title: 'Optional-ish' });
    expect((await shiftGateBlockers(rider)).map((g) => g.moduleId)).toEqual([m.id]);
    vi.mocked(getTrainingShiftGate).mockResolvedValueOnce(false);
    expect(await shiftGateBlockers(rider)).toEqual([]);
  });
});
