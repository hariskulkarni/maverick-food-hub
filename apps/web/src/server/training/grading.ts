/**
 * Training library v2 — pure rules: quiz grading, retake eligibility, and the
 * per-learner module status (progress, certification, re-certification,
 * overdue). No DB access, so every rule is unit-testable.
 */
import { randomBytes } from 'node:crypto';

// ─── Grading ─────────────────────────────────────────────────────────────────

export interface GradeResult {
  correctCount: number;
  totalCount: number;
  scorePct: number;
  passed: boolean;
  results: { questionId: string; chosenIndex: number | null; correct: boolean }[];
}

/** Unanswered or out-of-range answers count as wrong. A quiz with no questions passes. */
export function gradeQuiz(
  questions: { id: string; correctIndex: number }[],
  answers: Record<string, unknown>,
  passMarkPct: number,
): GradeResult {
  const results = questions.map((q) => {
    const raw = answers[q.id];
    const chosen = typeof raw === 'number' && Number.isInteger(raw) ? raw : null;
    return { questionId: q.id, chosenIndex: chosen, correct: chosen !== null && chosen === q.correctIndex };
  });
  const totalCount = questions.length;
  const correctCount = results.filter((r) => r.correct).length;
  const scorePct = totalCount === 0 ? 100 : Math.round((correctCount / totalCount) * 100);
  return { correctCount, totalCount, scorePct, passed: scorePct >= clampPct(passMarkPct), results };
}

export function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 80;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ─── Retake eligibility ──────────────────────────────────────────────────────

export type AttemptBlockReason = 'already_passed' | 'max_attempts' | 'cooldown' | 'lessons_incomplete';

export interface Eligibility {
  allowed: boolean;
  reason: AttemptBlockReason | null;
  attemptsUsed: number;
  /** null = unlimited */
  attemptsLeft: number | null;
  retryAt: Date | null;
}

/** `attempts` must already be filtered to the module's CURRENT version. */
export function attemptEligibility(input: {
  attempts: { createdAt: Date; passed: boolean }[];
  maxAttempts: number | null;
  retakeCooldownMin: number;
  lessonsComplete: boolean;
  now: Date;
}): Eligibility {
  const used = input.attempts.length;
  const left = input.maxAttempts == null ? null : Math.max(0, input.maxAttempts - used);
  const base = { attemptsUsed: used, attemptsLeft: left, retryAt: null };
  if (input.attempts.some((a) => a.passed)) return { ...base, allowed: false, reason: 'already_passed' };
  if (!input.lessonsComplete) return { ...base, allowed: false, reason: 'lessons_incomplete' };
  if (left !== null && left <= 0) return { ...base, allowed: false, reason: 'max_attempts' };
  if (used > 0 && input.retakeCooldownMin > 0) {
    const lastAt = Math.max(...input.attempts.map((a) => a.createdAt.getTime()));
    const retryAt = new Date(lastAt + input.retakeCooldownMin * 60_000);
    if (retryAt > input.now) return { ...base, allowed: false, reason: 'cooldown', retryAt };
  }
  return { ...base, allowed: true, reason: null };
}

// ─── Module status ───────────────────────────────────────────────────────────

export type ModuleState = 'NOT_STARTED' | 'IN_PROGRESS' | 'QUIZ_READY' | 'CERTIFIED' | 'RECERT_REQUIRED';

export interface StatusInput {
  version: number;
  versionPublishedAt: Date;
  lessonIds: string[];
  /** All of this learner's completions for the module (any version). */
  completions: { lessonId: string; moduleVersion: number }[];
  questionCount: number;
  /** All of this learner's attempts for the module (any version). */
  attempts: { moduleVersion: number; passed: boolean; scorePct: number; createdAt: Date }[];
  /** All of this learner's certificates for the module (any version). */
  certificates: { moduleVersion: number; issuedAt: Date; scorePct: number | null; code: string }[];
  isRequired: boolean;
  dueDays: number;
  learnerSince: Date;
  now: Date;
}

export interface ModuleStatus {
  state: ModuleState;
  lessonsDone: number;
  lessonsTotal: number;
  completedLessonIds: string[];
  /** 0–100; quiz counts as one extra step when present. */
  progressPct: number;
  certified: boolean;
  certificate: { moduleVersion: number; issuedAt: Date; scorePct: number | null; code: string } | null;
  /** Holds an older-version certificate but not the current one. */
  needsRecert: boolean;
  bestScorePct: number | null;
  dueAt: Date | null;
  overdue: boolean;
}

export function computeModuleStatus(s: StatusInput): ModuleStatus {
  const lessonSet = new Set(s.lessonIds);
  const completedLessonIds = s.completions
    .filter((c) => c.moduleVersion === s.version && lessonSet.has(c.lessonId))
    .map((c) => c.lessonId);
  const lessonsDone = new Set(completedLessonIds).size;
  const lessonsTotal = s.lessonIds.length;

  const current = s.certificates.find((c) => c.moduleVersion === s.version) ?? null;
  const older = s.certificates.some((c) => c.moduleVersion < s.version);
  const currentAttempts = s.attempts.filter((a) => a.moduleVersion === s.version);
  const bestScorePct = currentAttempts.length ? Math.max(...currentAttempts.map((a) => a.scorePct)) : null;

  const steps = lessonsTotal + (s.questionCount > 0 ? 1 : 0);
  const stepsDone = current ? steps : lessonsDone + (currentAttempts.some((a) => a.passed) ? 1 : 0);
  const progressPct = current ? 100 : steps === 0 ? 0 : Math.min(100, Math.round((stepsDone / steps) * 100));

  let state: ModuleState;
  if (current) state = 'CERTIFIED';
  else if (older) state = 'RECERT_REQUIRED';
  else if (lessonsDone === 0 && currentAttempts.length === 0) state = 'NOT_STARTED';
  else if (lessonsDone >= lessonsTotal && s.questionCount > 0) state = 'QUIZ_READY';
  else state = 'IN_PROGRESS';

  let dueAt: Date | null = null;
  if (s.isRequired) {
    const from = Math.max(s.versionPublishedAt.getTime(), s.learnerSince.getTime());
    dueAt = new Date(from + Math.max(0, s.dueDays) * 86_400_000);
  }

  return {
    state,
    lessonsDone,
    lessonsTotal,
    completedLessonIds: [...new Set(completedLessonIds)],
    progressPct,
    certified: !!current,
    certificate: current,
    needsRecert: !current && older,
    bestScorePct,
    dueAt,
    overdue: !!dueAt && !current && s.now > dueAt,
  };
}

/** Lessons done and (no quiz OR a passing attempt) → certificate is due. */
export function shouldIssueCertificate(status: Pick<ModuleStatus, 'lessonsDone' | 'lessonsTotal' | 'certified'>, opts: {
  questionCount: number;
  passedAttempt: boolean;
}): boolean {
  if (status.certified) return false;
  if (status.lessonsDone < status.lessonsTotal) return false;
  return opts.questionCount === 0 || opts.passedAttempt;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. FLV-7K2M9QX4 — 8 chars from an unambiguous alphabet. */
export function newCertificateCode(): string {
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `FLV-${s}`;
}
