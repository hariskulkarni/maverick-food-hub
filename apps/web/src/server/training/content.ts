/**
 * Training library v2 — pure content helpers (no DB):
 *   • localization with field-level fallback to the base language
 *   • legacy (block / plain-text) → lessons + questions, used to migrate
 *     pre-v2 modules forward without losing their content
 *   • lessons + questions → legacy contentBlocks / contentBody, so rider-native
 *     builds that predate v2 keep rendering a readable lesson
 */
import { parseContentBlocks, type ContentBlock } from '@/server/training-cms';
import { parseMarkdown, spansToText } from '@/lib/training-markdown';
import type {
  LessonInput,
  LessonKind,
  QuestionInput,
  TrainingLanguage,
  LessonTranslation,
  QuestionTranslation,
  ModuleTranslation,
} from './types';
import { LESSON_KINDS, TRAINING_LANGUAGES } from './types';

export function normalizeLang(v: unknown): TrainingLanguage {
  return typeof v === 'string' && (TRAINING_LANGUAGES as readonly string[]).includes(v)
    ? (v as TrainingLanguage)
    : 'en';
}

export function asStringArray(v: unknown, perMax = 400, listMax = 40): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.slice(0, perMax))
    .filter((x) => x.trim().length > 0)
    .slice(0, listMax);
}

function translationFor<T>(translations: unknown, lang: TrainingLanguage): Partial<T> {
  if (lang === 'en' || !translations || typeof translations !== 'object') return {};
  const t = (translations as Record<string, unknown>)[lang];
  return t && typeof t === 'object' ? (t as Partial<T>) : {};
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Languages (besides the base) that have at least a translated title. */
export function availableLanguages(translations: unknown): TrainingLanguage[] {
  const out: TrainingLanguage[] = ['en'];
  if (translations && typeof translations === 'object') {
    for (const l of TRAINING_LANGUAGES) {
      if (l === 'en') continue;
      const t = (translations as Record<string, any>)[l];
      if (t && nonEmpty(t.title)) out.push(l);
    }
  }
  return out;
}

export function localizeModuleText(
  m: { title: string; summary: string | null; translations?: unknown },
  lang: TrainingLanguage,
) {
  const t = translationFor<ModuleTranslation>(m.translations, lang);
  return {
    title: nonEmpty(t.title) ? t.title : m.title,
    summary: nonEmpty(t.summary) ? t.summary : m.summary,
  };
}

export interface LessonRowLike {
  id: string;
  order: number;
  kind: LessonKind;
  title: string;
  body: string;
  mediaUrl: string | null;
  checklistItems: unknown;
  translations?: unknown;
}

export function localizeLesson(l: LessonRowLike, lang: TrainingLanguage) {
  const t = translationFor<LessonTranslation>(l.translations, lang);
  const baseItems = asStringArray(l.checklistItems);
  const tItems = asStringArray(t.checklistItems);
  return {
    id: l.id,
    order: l.order,
    kind: l.kind,
    title: nonEmpty(t.title) ? t.title : l.title,
    body: nonEmpty(t.body) ? t.body : l.body,
    mediaUrl: l.mediaUrl,
    checklistItems: tItems.length === baseItems.length && tItems.length > 0 ? tItems : baseItems,
  };
}

export interface QuestionRowLike {
  id: string;
  order: number;
  prompt: string;
  options: unknown;
  correctIndex: number;
  explanation: string | null;
  translations?: unknown;
}

/** Learner-facing question — NEVER includes the correct answer. */
export function localizeQuestion(q: QuestionRowLike, lang: TrainingLanguage) {
  const t = translationFor<QuestionTranslation>(q.translations, lang);
  const baseOpts = asStringArray(q.options);
  const tOpts = asStringArray(t.options);
  return {
    id: q.id,
    order: q.order,
    prompt: nonEmpty(t.prompt) ? t.prompt : q.prompt,
    options: tOpts.length === baseOpts.length && tOpts.length > 0 ? tOpts : baseOpts,
  };
}

export function localizedExplanation(q: QuestionRowLike, lang: TrainingLanguage): string | null {
  const t = translationFor<QuestionTranslation>(q.translations, lang);
  return nonEmpty(t.explanation) ? t.explanation : q.explanation;
}

// ─── Legacy → v2 ─────────────────────────────────────────────────────────────

function blockToMarkdown(b: ContentBlock): string {
  switch (b.type) {
    case 'paragraph':
      return b.text;
    case 'image':
      return `![${b.alt ?? b.caption ?? ''}](${b.src})${b.caption ? `\n\n*${b.caption}*` : ''}`;
    case 'callout':
      return `**${b.title ? b.title : 'Note'}:** ${b.body}`;
    case 'keyPoints':
      return `${b.title ? `### ${b.title}\n\n` : ''}${b.points.map((p) => `- ${p}`).join('\n')}`;
    default:
      return '';
  }
}

/**
 * Convert a pre-v2 module (block JSON, plain markdown-ish body and/or the old
 * `quizQuestions` JSON) into v2 lessons + questions. Headings start a new
 * lesson; checklists become CHECKLIST lessons; inline quiz blocks and legacy
 * quiz JSON become quiz questions.
 */
export function legacyToLessons(input: {
  title: string;
  contentBlocks: unknown;
  contentBody: string | null;
  quizQuestions: unknown;
}): { lessons: LessonInput[]; questions: QuestionInput[] } {
  const blocks = parseContentBlocks(input.contentBlocks);
  const lessons: LessonInput[] = [];
  const questions: QuestionInput[] = [];

  if (blocks.length > 0) {
    let current: { title: string; parts: string[] } | null = null;
    const flush = () => {
      if (current && current.parts.join('').trim()) {
        lessons.push({ kind: 'TEXT', title: current.title, body: current.parts.join('\n\n') });
      }
      current = null;
    };
    for (const b of blocks) {
      if (b.type === 'heading') {
        flush();
        current = { title: b.text, parts: [] };
      } else if (b.type === 'checklist') {
        flush();
        lessons.push({ kind: 'CHECKLIST', title: b.title || 'Checklist', body: '', checklistItems: b.items });
      } else if (b.type === 'quiz') {
        questions.push({
          prompt: b.question,
          options: b.options,
          correctIndex: b.correct,
          explanation: b.explanation ?? null,
        });
      } else if (b.type !== 'divider') {
        if (!current) current = { title: lessons.length === 0 ? input.title : 'Continued', parts: [] };
        const md = blockToMarkdown(b);
        if (md) current.parts.push(md);
      }
    }
    flush();
  } else if (input.contentBody && input.contentBody.trim()) {
    lessons.push({ kind: 'TEXT', title: input.title, body: input.contentBody.trim() });
  }

  if (Array.isArray(input.quizQuestions)) {
    for (const raw of input.quizQuestions) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const options = asStringArray(o.options, 200, 6);
      const answer = Number(o.answer ?? o.correct ?? o.correctIndex);
      if (typeof o.question !== 'string' || options.length < 2) continue;
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
      questions.push({ prompt: o.question, options, correctIndex: answer, explanation: null });
    }
  }

  return { lessons, questions };
}

// ─── v2 → legacy (for pre-v2 rider-native builds) ────────────────────────────

let legacySeq = 0;
const lid = (k: string) => `v2_${k}_${(legacySeq++).toString(36)}`;

export function lessonsToLegacyBlocks(
  lessons: Pick<LessonInput, 'kind' | 'title' | 'body' | 'mediaUrl' | 'checklistItems'>[],
  questions: Pick<QuestionInput, 'prompt' | 'options' | 'correctIndex' | 'explanation'>[],
): ContentBlock[] {
  const out: unknown[] = [];
  for (const l of lessons) {
    out.push({ id: lid('h'), type: 'heading', text: l.title });
    if (l.kind === 'IMAGE' && l.mediaUrl) out.push({ id: lid('img'), type: 'image', src: l.mediaUrl, alt: l.title });
    if (l.kind === 'VIDEO' && l.mediaUrl) {
      out.push({ id: lid('v'), type: 'callout', tone: 'info', title: 'Video', body: `Watch: ${l.mediaUrl}` });
    }
    for (const b of parseMarkdown(l.body ?? '')) {
      if (b.type === 'heading') out.push({ id: lid('h'), type: 'heading', text: b.text });
      else if (b.type === 'paragraph') out.push({ id: lid('p'), type: 'paragraph', text: spansToText(b.spans) });
      else if (b.type === 'list') out.push({ id: lid('k'), type: 'keyPoints', points: b.items.map(spansToText) });
      else if (b.type === 'image') out.push({ id: lid('img'), type: 'image', src: b.src, alt: b.alt });
    }
    if (l.kind === 'CHECKLIST' && l.checklistItems?.length) {
      out.push({ id: lid('c'), type: 'checklist', items: l.checklistItems });
    }
  }
  for (const q of questions) {
    out.push({
      id: lid('q'),
      type: 'quiz',
      question: q.prompt,
      options: q.options,
      correct: q.correctIndex,
      explanation: q.explanation ?? undefined,
    });
  }
  return parseContentBlocks(out);
}

/** Short plain-text fallback for the legacy `contentBody` column. */
export function lessonsToPlainText(summary: string | null, lessons: Pick<LessonInput, 'title'>[]): string {
  const head = summary?.trim() ? `${summary.trim()}\n\n` : '';
  return `${head}${lessons.map((l, i) => `${i + 1}. ${l.title}`).join('\n')}`.trim() || 'Training module';
}

export function isLessonKind(v: unknown): v is LessonKind {
  return typeof v === 'string' && (LESSON_KINDS as readonly string[]).includes(v);
}
