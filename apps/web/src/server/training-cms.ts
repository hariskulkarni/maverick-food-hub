/**
 * Training-module CMS — block-based lesson format.
 *
 * A lesson is an array of typed `ContentBlock`s. The block types are designed
 * to be simple to render on both the web lesson player AND the rider-native
 * RN screen — no markdown parser, no HTML, just typed JSON.
 *
 * Block types:
 *   • heading    — section heading (h2-style)
 *   • paragraph  — body copy (one block per paragraph for clean reflow)
 *   • image      — full-width photo with optional caption (e.g. Unsplash URLs)
 *   • callout    — coloured info card (tip / warning / success / danger)
 *   • checklist  — interactive checklist with tickable items (state held in player)
 *   • keyPoints  — bullet list of short summary points (visual: chip grid)
 *   • divider    — visual separator (no content)
 *   • quiz       — single-question inline check (radio options, correct index)
 *
 * `parseContentBlocks()` is total: malformed input returns []; bad blocks are
 * dropped. The renderer can then safely iterate and dispatch by `type`.
 */
import { DEFAULT_TRAINING_CONTENT, type TrainingDefault } from './training-defaults';

export type ContentBlockType =
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'callout'
  | 'checklist'
  | 'keyPoints'
  | 'divider'
  | 'quiz';

export type CalloutTone = 'tip' | 'warning' | 'success' | 'danger' | 'info';

export interface HeadingBlock { id: string; type: 'heading'; text: string; }
export interface ParagraphBlock { id: string; type: 'paragraph'; text: string; }
export interface ImageBlock { id: string; type: 'image'; src: string; alt?: string; caption?: string; }
export interface CalloutBlock { id: string; type: 'callout'; tone: CalloutTone; title?: string; body: string; }
export interface ChecklistBlock { id: string; type: 'checklist'; title?: string; items: string[]; }
export interface KeyPointsBlock { id: string; type: 'keyPoints'; title?: string; points: string[]; }
export interface DividerBlock { id: string; type: 'divider'; }
export interface QuizBlock {
  id: string;
  type: 'quiz';
  question: string;
  options: string[];
  /** Index of the correct option in `options` (0-based). */
  correct: number;
  explanation?: string;
}

export type ContentBlock =
  | HeadingBlock | ParagraphBlock | ImageBlock | CalloutBlock
  | ChecklistBlock | KeyPointsBlock | DividerBlock | QuizBlock;

export const BLOCK_TYPES: ContentBlockType[] = [
  'heading', 'paragraph', 'image', 'callout', 'checklist', 'keyPoints', 'divider', 'quiz',
];
export const CALLOUT_TONES: CalloutTone[] = ['tip', 'warning', 'success', 'danger', 'info'];

// ── primitive coercers ────────────────────────────────────────────────────
const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const url = (v: unknown, max = 2048) => str(v, max).trim();
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
const strArr = (v: unknown, perMax = 600, listMax = 30) =>
  Array.isArray(v) ? v.map((x) => str(x, perMax)).filter((s) => s.trim().length > 0).slice(0, listMax) : [];

let blockSeq = 0;
function newId(): string {
  return `b_${Date.now().toString(36)}_${(blockSeq++).toString(36)}`;
}

function parseBlock(raw: unknown): ContentBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = oneOf<ContentBlockType>(o.type, BLOCK_TYPES, 'paragraph');
  const id = str(o.id, 64) || newId();
  switch (type) {
    case 'heading': {
      const text = str(o.text, 200).trim();
      if (!text) return null;
      return { id, type, text };
    }
    case 'paragraph': {
      const text = str(o.text, 4000).trim();
      if (!text) return null;
      return { id, type, text };
    }
    case 'image': {
      const src = url(o.src);
      if (!src) return null;
      return { id, type, src, alt: str(o.alt, 240) || undefined, caption: str(o.caption, 400) || undefined };
    }
    case 'callout': {
      const tone = oneOf<CalloutTone>(o.tone, CALLOUT_TONES, 'tip');
      const body = str(o.body, 2000).trim();
      if (!body) return null;
      return { id, type, tone, title: str(o.title, 160) || undefined, body };
    }
    case 'checklist': {
      const items = strArr(o.items, 240, 20);
      if (items.length === 0) return null;
      return { id, type, title: str(o.title, 160) || undefined, items };
    }
    case 'keyPoints': {
      const points = strArr(o.points, 240, 12);
      if (points.length === 0) return null;
      return { id, type, title: str(o.title, 160) || undefined, points };
    }
    case 'divider':
      return { id, type };
    case 'quiz': {
      const question = str(o.question, 400).trim();
      const options = strArr(o.options, 200, 6);
      if (!question || options.length < 2) return null;
      const correctRaw = Number(o.correct);
      const correct = Number.isInteger(correctRaw) && correctRaw >= 0 && correctRaw < options.length ? correctRaw : 0;
      return { id, type, question, options, correct, explanation: str(o.explanation, 600) || undefined };
    }
  }
}

/** Total: never throws. Bad input → []. Bad blocks dropped. */
export function parseContentBlocks(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentBlock[] = [];
  for (const b of raw) {
    const parsed = parseBlock(b);
    if (parsed) out.push(parsed);
  }
  return out.slice(0, 200);
}

/** Plain-text "reading time" estimator for fallback when no contentBody. */
export function blocksToPlainText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': parts.push(`## ${b.text}`); break;
      case 'paragraph': parts.push(b.text); break;
      case 'callout': parts.push((b.title ? `[${b.title}] ` : '') + b.body); break;
      case 'checklist': parts.push((b.title ? `${b.title}\n` : '') + b.items.map((i) => `• ${i}`).join('\n')); break;
      case 'keyPoints': parts.push((b.title ? `${b.title}\n` : '') + b.points.map((p) => `• ${p}`).join('\n')); break;
      case 'quiz': parts.push(`Q: ${b.question}`); break;
      case 'image': if (b.caption) parts.push(`[Image: ${b.caption}]`); break;
    }
  }
  return parts.join('\n\n');
}

/** Re-export the curated default content so callers (seed/upgrade scripts +
 *  API safe-fallback) all share one source of truth. */
export const TRAINING_DEFAULTS = DEFAULT_TRAINING_CONTENT;
export type { TrainingDefault };
