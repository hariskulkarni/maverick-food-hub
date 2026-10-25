/**
 * Pure helpers for OnboardingProgress JSON columns (steps + drafts). The DB
 * stores free-form JSON, so everything read back is normalised here before use
 * and every write is validated here first.
 */
import { ONBOARDING_STEPS, ONBOARDING_STEP_KEYS, isStepKey, stepDef, type OnboardingStepKey, type StepState } from './steps';

export type StepStates = Record<OnboardingStepKey, StepState>;
export type StepDrafts = Partial<Record<OnboardingStepKey, unknown>>;

/** Largest draft we keep per step (serialised JSON bytes). Drafts are form state, not content. */
export const MAX_DRAFT_BYTES = 16 * 1024;

const STATES: readonly StepState[] = ['todo', 'done', 'skipped'];

export function normaliseSteps(raw: unknown): StepStates {
  const out = Object.fromEntries(ONBOARDING_STEP_KEYS.map((k) => [k, 'todo'])) as StepStates;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isStepKey(k) && STATES.includes(v as StepState)) {
        // A non-skippable step can never be persisted as skipped.
        out[k] = v === 'skipped' && !stepDef(k).skippable ? 'todo' : (v as StepState);
      }
    }
  }
  return out;
}

export function normaliseDrafts(raw: unknown): StepDrafts {
  const out: StepDrafts = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isStepKey(k) && v !== undefined && v !== null) out[k] = v;
    }
  }
  return out;
}

export class ProgressUpdateError extends Error {}

/** Set one step's state. Throws ProgressUpdateError for disallowed transitions. */
export function applyStepState(steps: StepStates, key: OnboardingStepKey, state: StepState): StepStates {
  if (state === 'skipped' && !stepDef(key).skippable) {
    throw new ProgressUpdateError(`"${stepDef(key).title}" is required and can't be skipped.`);
  }
  if (key === 'golive' && state !== 'todo') {
    // Completion of the final step is only granted by the go-live route after real checks.
    throw new ProgressUpdateError('Use "Go live" to finish — it runs the readiness checks first.');
  }
  return { ...steps, [key]: state };
}

/** Store (or clear, with null) one step's draft. Throws when the draft is too large. */
export function applyDraft(drafts: StepDrafts, key: OnboardingStepKey, draft: unknown): StepDrafts {
  const next = { ...drafts };
  if (draft === null) {
    delete next[key];
    return next;
  }
  const size = new TextEncoder().encode(JSON.stringify(draft) ?? '').length;
  if (size > MAX_DRAFT_BYTES) {
    throw new ProgressUpdateError(`Draft for "${stepDef(key).title}" is too large to save (${Math.round(size / 1024)} KB, limit 16 KB).`);
  }
  next[key] = draft;
  return next;
}

/** Share of steps (excluding the final go-live step) that are done or skipped, 0–100. */
export function progressPercent(steps: StepStates, completed: boolean): number {
  if (completed) return 100;
  const work = ONBOARDING_STEPS.filter((s) => s.key !== 'golive');
  const finished = work.filter((s) => steps[s.key] !== 'todo').length;
  return Math.round((finished / work.length) * 100);
}

/** First step still marked todo (falls back to the go-live step). */
export function firstIncompleteStep(steps: StepStates): OnboardingStepKey {
  return ONBOARDING_STEPS.find((s) => steps[s.key] === 'todo')?.key ?? 'golive';
}
