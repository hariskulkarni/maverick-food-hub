import { describe, it, expect } from 'vitest';
import {
  attemptEligibility,
  computeModuleStatus,
  gradeQuiz,
  newCertificateCode,
  shouldIssueCertificate,
  type StatusInput,
} from '@/server/training/grading';

const Q = [
  { id: 'q1', correctIndex: 0 },
  { id: 'q2', correctIndex: 1 },
  { id: 'q3', correctIndex: 2 },
  { id: 'q4', correctIndex: 3 },
  { id: 'q5', correctIndex: 0 },
];

describe('gradeQuiz', () => {
  it('scores and passes at the pass mark', () => {
    const r = gradeQuiz(Q, { q1: 0, q2: 1, q3: 2, q4: 3, q5: 1 }, 80);
    expect(r).toMatchObject({ correctCount: 4, totalCount: 5, scorePct: 80, passed: true });
    expect(r.results.find((x) => x.questionId === 'q5')).toMatchObject({ chosenIndex: 1, correct: false });
  });

  it('fails below the pass mark and treats unanswered / junk answers as wrong', () => {
    const r = gradeQuiz(Q, { q1: 0, q2: '1', q3: 2.5, q4: null }, 80);
    expect(r.correctCount).toBe(1);
    expect(r.scorePct).toBe(20);
    expect(r.passed).toBe(false);
    expect(r.results.filter((x) => x.chosenIndex === null)).toHaveLength(4);
  });

  it('ignores answers for questions not in the quiz', () => {
    const r = gradeQuiz(Q.slice(0, 1), { q1: 0, bogus: 3 }, 100);
    expect(r).toMatchObject({ totalCount: 1, passed: true });
  });
});

describe('attemptEligibility', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const base = { maxAttempts: null, retakeCooldownMin: 0, lessonsComplete: true, now };

  it('allows the first attempt once lessons are done', () => {
    expect(attemptEligibility({ ...base, attempts: [] })).toMatchObject({ allowed: true, attemptsUsed: 0, attemptsLeft: null });
  });

  it('blocks until lessons are complete', () => {
    expect(attemptEligibility({ ...base, attempts: [], lessonsComplete: false })).toMatchObject({ allowed: false, reason: 'lessons_incomplete' });
  });

  it('enforces the cooldown after a failed attempt', () => {
    const e = attemptEligibility({
      ...base,
      retakeCooldownMin: 5,
      attempts: [{ createdAt: new Date(now.getTime() - 2 * 60_000), passed: false }],
    });
    expect(e).toMatchObject({ allowed: false, reason: 'cooldown' });
    expect(e.retryAt?.toISOString()).toBe('2026-10-24T10:03:00.000Z');
    const later = attemptEligibility({
      ...base,
      retakeCooldownMin: 5,
      attempts: [{ createdAt: new Date(now.getTime() - 6 * 60_000), passed: false }],
    });
    expect(later.allowed).toBe(true);
  });

  it('enforces max attempts', () => {
    const fails = [1, 2, 3].map((i) => ({ createdAt: new Date(now.getTime() - i * 3600_000), passed: false }));
    expect(attemptEligibility({ ...base, maxAttempts: 3, attempts: fails })).toMatchObject({ allowed: false, reason: 'max_attempts', attemptsLeft: 0 });
    expect(attemptEligibility({ ...base, maxAttempts: 4, attempts: fails })).toMatchObject({ allowed: true, attemptsLeft: 1 });
  });

  it('reports already_passed after a pass', () => {
    expect(attemptEligibility({ ...base, attempts: [{ createdAt: now, passed: true }] })).toMatchObject({ allowed: false, reason: 'already_passed' });
  });
});

describe('computeModuleStatus', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const s = (over: Partial<StatusInput> = {}): StatusInput => ({
    version: 1,
    versionPublishedAt: new Date('2026-10-01T00:00:00Z'),
    lessonIds: ['l1', 'l2', 'l3'],
    completions: [],
    questionCount: 5,
    attempts: [],
    certificates: [],
    isRequired: true,
    dueDays: 7,
    learnerSince: new Date('2026-10-20T00:00:00Z'),
    now,
    ...over,
  });

  it('not started → in progress → quiz ready', () => {
    expect(computeModuleStatus(s()).state).toBe('NOT_STARTED');
    const ip = computeModuleStatus(s({ completions: [{ lessonId: 'l1', moduleVersion: 1 }] }));
    expect(ip).toMatchObject({ state: 'IN_PROGRESS', lessonsDone: 1, progressPct: 25 });
    const qr = computeModuleStatus(
      s({ completions: ['l1', 'l2', 'l3'].map((lessonId) => ({ lessonId, moduleVersion: 1 })) }),
    );
    expect(qr).toMatchObject({ state: 'QUIZ_READY', progressPct: 75 });
  });

  it('certified only for the current version', () => {
    const cert = { moduleVersion: 1, issuedAt: now, scorePct: 100, code: 'FLV-X' };
    expect(computeModuleStatus(s({ certificates: [cert] }))).toMatchObject({ state: 'CERTIFIED', certified: true, progressPct: 100, overdue: false });
  });

  it('a version bump requires re-certification and resets stale lesson progress', () => {
    const st = computeModuleStatus(
      s({
        version: 2,
        versionPublishedAt: new Date('2026-10-10T00:00:00Z'),
        completions: [{ lessonId: 'l1', moduleVersion: 1 }],
        certificates: [{ moduleVersion: 1, issuedAt: new Date('2026-10-05'), scorePct: 80, code: 'FLV-OLD' }],
      }),
    );
    expect(st).toMatchObject({ state: 'RECERT_REQUIRED', certified: false, needsRecert: true, lessonsDone: 0 });
  });

  it('due date counts from the later of joining and version publish; overdue only when required', () => {
    const fresh = computeModuleStatus(s());
    expect(fresh.dueAt?.toISOString()).toBe('2026-10-27T00:00:00.000Z');
    expect(fresh.overdue).toBe(false);
    const old = computeModuleStatus(s({ learnerSince: new Date('2026-09-01T00:00:00Z') }));
    expect(old.dueAt?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(old.overdue).toBe(true);
    expect(computeModuleStatus(s({ learnerSince: new Date('2026-09-01'), isRequired: false })).overdue).toBe(false);
  });
});

describe('shouldIssueCertificate', () => {
  it('needs all lessons, plus a pass when there is a quiz', () => {
    expect(shouldIssueCertificate({ lessonsDone: 2, lessonsTotal: 3, certified: false }, { questionCount: 0, passedAttempt: false })).toBe(false);
    expect(shouldIssueCertificate({ lessonsDone: 3, lessonsTotal: 3, certified: false }, { questionCount: 0, passedAttempt: false })).toBe(true);
    expect(shouldIssueCertificate({ lessonsDone: 3, lessonsTotal: 3, certified: false }, { questionCount: 5, passedAttempt: false })).toBe(false);
    expect(shouldIssueCertificate({ lessonsDone: 3, lessonsTotal: 3, certified: false }, { questionCount: 5, passedAttempt: true })).toBe(true);
    expect(shouldIssueCertificate({ lessonsDone: 3, lessonsTotal: 3, certified: true }, { questionCount: 0, passedAttempt: true })).toBe(false);
  });
});

describe('newCertificateCode', () => {
  it('is FLV- plus 8 unambiguous characters', () => {
    const codes = new Set(Array.from({ length: 200 }, newCertificateCode));
    for (const c of codes) expect(c).toMatch(/^FLV-[A-HJ-NP-Z2-9]{8}$/);
    expect(codes.size).toBe(200);
  });
});
