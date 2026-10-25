/**
 * Training library v2 — shared, client-safe types.
 *
 * A module is an ordered list of lessons plus an optional multiple-choice
 * quiz. Translations are stored per row as `{ hi: { ...fields } }` and
 * resolved field-by-field with a fallback to the base (English) content, so a
 * partially translated module still renders completely.
 */

export const TRAINING_AUDIENCES = ['RIDER', 'KITCHEN', 'RESTAURANT_ADMIN'] as const;
export type TrainingAudience = (typeof TRAINING_AUDIENCES)[number];

export const LESSON_KINDS = ['TEXT', 'IMAGE', 'VIDEO', 'CHECKLIST'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const TRAINING_CATEGORIES = [
  'ONBOARDING',
  'SAFETY',
  'CUSTOMER_SERVICE',
  'EARNINGS',
  'APP_GUIDE',
  'HYGIENE',
  'KITCHEN_OPS',
  'RESTAURANT_OPS',
] as const;
export type TrainingCategoryV2 = (typeof TRAINING_CATEGORIES)[number];

export const TRAINING_LANGUAGES = ['en', 'hi'] as const;
export type TrainingLanguage = (typeof TRAINING_LANGUAGES)[number];

export interface LessonTranslation {
  title?: string;
  body?: string;
  checklistItems?: string[];
}

export interface QuestionTranslation {
  prompt?: string;
  options?: string[];
  explanation?: string;
}

export interface ModuleTranslation {
  title?: string;
  summary?: string;
}

/** Authoring / seed shape for one lesson. `body` is markdown. */
export interface LessonInput {
  id?: string;
  kind: LessonKind;
  title: string;
  body: string;
  /** Image URL (IMAGE) or video URL (VIDEO). */
  mediaUrl?: string | null;
  /** CHECKLIST items. */
  checklistItems?: string[];
  translations?: { hi?: LessonTranslation };
}

/** Authoring / seed shape for one multiple-choice question (single answer). */
export interface QuestionInput {
  id?: string;
  prompt: string;
  options: string[];
  /** 0-based index into `options`. */
  correctIndex: number;
  explanation?: string | null;
  translations?: { hi?: QuestionTranslation };
}

/** One starter module in the Flavrly seed library. */
export interface SeedModule {
  /** Stable key — the seed script upserts by slug. */
  slug: string;
  /** Titles of pre-existing rows this module adopts (keeps their id + history). */
  legacyAliases?: string[];
  title: string;
  summary: string;
  category: TrainingCategoryV2;
  audience: TrainingAudience;
  isRequired: boolean;
  /** Safety-critical: blocks going online until passed (only when the platform gate is on). */
  blocksShift?: boolean;
  durationMin: number;
  order: number;
  passMarkPct: number;
  /** null = unlimited attempts per version. */
  maxAttempts: number | null;
  retakeCooldownMin: number;
  /** Days a learner has to finish a required module before it shows as overdue. */
  dueDays: number;
  translations?: { hi?: ModuleTranslation };
  lessons: LessonInput[];
  questions: QuestionInput[];
}
