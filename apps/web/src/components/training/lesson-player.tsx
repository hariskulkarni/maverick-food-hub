'use client';

import { useEffect, useMemo, useState } from 'react';
import { ImageWithFallback } from '@/components/image-with-fallback';
import {
  Lightbulb, AlertTriangle, CheckCircle2, XCircle, Info, Sparkles,
  Trophy, Check, X, Loader2,
} from 'lucide-react';
import type { ContentBlock, CalloutTone } from '@/server/training-cms';

/**
 * LessonPlayer — renders a block-based training module on the web.
 *
 * Two modes:
 *   • mode="preview" — super-admin preview (no progress writes, no completion).
 *   • mode="rider"   — actual rider view; clicking "Complete module" POSTs to
 *                       /api/rider/training/[moduleId] with the quiz score.
 *
 * Behaviour:
 *   • Progress bar fills as the reader scrolls (intersection observer).
 *   • Checklist items are tickable (state held locally — purely UX).
 *   • Each <quiz> block is an inline single-question check with immediate
 *     feedback. Total quiz score is shown in the completion bar at the end.
 *   • A floating "Complete module" button appears once the reader has passed
 *     ~85% of the content (so we never count a skim-through as completion).
 */

const CALLOUT_STYLES: Record<CalloutTone, { Icon: any; cls: string; iconCls: string }> = {
  tip:     { Icon: Lightbulb,      cls: 'border-primary/30 bg-primary/5',         iconCls: 'text-primary' },
  warning: { Icon: AlertTriangle,  cls: 'border-warning/40 bg-warning/10',        iconCls: 'text-warning' },
  success: { Icon: CheckCircle2,   cls: 'border-success/40 bg-success/10',        iconCls: 'text-success' },
  danger:  { Icon: XCircle,        cls: 'border-destructive/40 bg-destructive/10', iconCls: 'text-destructive' },
  info:    { Icon: Info,           cls: 'border-border bg-muted/40',              iconCls: 'text-muted-foreground' },
};

interface LessonPlayerProps {
  moduleId: string;
  title: string;
  summary?: string | null;
  heroImageUrl?: string | null;
  durationMin: number;
  blocks: ContentBlock[];
  mode: 'preview' | 'rider';
  onCompleted?: (quizScorePct: number | null) => void;
  initiallyCompleted?: boolean;
}

export function LessonPlayer({
  moduleId, title, summary, heroImageUrl, durationMin, blocks, mode,
  onCompleted, initiallyCompleted = false,
}: LessonPlayerProps) {
  const [progress, setProgress] = useState(0); // 0..1 read progress
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [completed, setCompleted] = useState(initiallyCompleted);
  const [submitting, setSubmitting] = useState(false);

  const quizBlocks = useMemo(() => blocks.filter((b) => b.type === 'quiz') as Extract<ContentBlock, { type: 'quiz' }>[], [blocks]);
  const answeredCount = quizBlocks.filter((q) => quizAnswers[q.id] !== undefined).length;
  const correctCount = quizBlocks.filter((q) => quizAnswers[q.id] === q.correct).length;
  const quizScorePct = quizBlocks.length > 0 ? Math.round((correctCount / quizBlocks.length) * 100) : null;

  // Track read progress by watching how far the last block has scrolled into view.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onScroll() {
      const el = document.getElementById(`lp-end-${moduleId}`);
      const top = document.getElementById(`lp-top-${moduleId}`);
      if (!el || !top) return;
      const start = top.getBoundingClientRect().top + window.scrollY;
      const end = el.getBoundingClientRect().top + window.scrollY;
      const total = Math.max(1, end - start);
      const scrolled = Math.max(0, Math.min(total, window.scrollY - start));
      setProgress(scrolled / total);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [moduleId]);

  const canComplete = progress > 0.85 && (quizBlocks.length === 0 || answeredCount === quizBlocks.length) && !completed;

  async function markComplete() {
    if (mode === 'preview') {
      setCompleted(true);
      onCompleted?.(quizScorePct);
      return;
    }
    setSubmitting(true);
    try {
      const body: any = {};
      if (quizScorePct !== null) body.quizScore = quizScorePct;
      const r = await fetch(`/api/rider/training/${moduleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Failed to mark complete');
      setCompleted(true);
      onCompleted?.(quizScorePct);
    } catch {
      // toast on rider side, swallow silently here — caller can re-try.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-32">
      {/* Sticky progress bar */}
      <div className="sticky top-0 z-30 -mx-4 md:mx-0 mb-6 bg-background/95 backdrop-blur border-b">
        <div className="h-1 bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="container py-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{Math.round(progress * 100)}% read · {durationMin} min lesson</span>
          {quizBlocks.length > 0 && (
            <span>Quiz: {answeredCount}/{quizBlocks.length} answered{quizScorePct !== null && answeredCount === quizBlocks.length ? ` · ${quizScorePct}%` : ''}</span>
          )}
        </div>
      </div>

      <div id={`lp-top-${moduleId}`} />

      {/* Hero */}
      {heroImageUrl && (
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl mb-6 bg-muted">
          <ImageWithFallback src={heroImageUrl} alt={title} fill priority sizes="(min-width:768px) 720px, 100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
            <h1 className="display text-2xl md:text-4xl font-bold leading-tight">{title}</h1>
            {summary && <p className="mt-1 text-sm md:text-base text-white/90 max-w-2xl">{summary}</p>}
          </div>
        </div>
      )}
      {!heroImageUrl && (
        <header className="mb-6">
          <h1 className="display text-2xl md:text-4xl font-bold leading-tight">{title}</h1>
          {summary && <p className="mt-2 text-sm md:text-base text-muted-foreground">{summary}</p>}
        </header>
      )}

      {/* Blocks */}
      <div className="space-y-6">
        {blocks.map((b, i) => (
          <BlockRenderer
            key={b.id}
            block={b}
            isFirst={i === 0}
            quizAnswer={quizAnswers[b.id]}
            onQuizAnswer={(idx) => setQuizAnswers((a) => ({ ...a, [b.id]: idx }))}
          />
        ))}
      </div>

      <div id={`lp-end-${moduleId}`} />

      {/* Completion bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="container py-3 flex items-center justify-between gap-3 max-w-3xl">
          <div className="text-sm">
            {completed ? (
              <span className="inline-flex items-center gap-2 text-success font-semibold">
                <Trophy className="size-4" /> Module completed{quizScorePct !== null ? ` — ${quizScorePct}% on the quiz` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {progress < 0.85
                  ? `Keep reading… ${Math.round(progress * 100)}% done`
                  : quizBlocks.length > 0 && answeredCount < quizBlocks.length
                  ? `Answer ${quizBlocks.length - answeredCount} more question${quizBlocks.length - answeredCount === 1 ? '' : 's'} to finish`
                  : 'Ready to mark complete'}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={markComplete}
            disabled={!canComplete || submitting || completed}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {completed ? 'Completed' : mode === 'preview' ? 'Preview complete' : 'Complete module'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────── Block renderer ───────────────────────────────
function BlockRenderer({
  block, isFirst, quizAnswer, onQuizAnswer,
}: {
  block: ContentBlock;
  isFirst: boolean;
  quizAnswer: number | undefined;
  onQuizAnswer: (idx: number) => void;
}) {
  switch (block.type) {
    case 'heading':
      return <h2 className={`display text-xl md:text-2xl font-bold leading-tight ${isFirst ? '' : 'pt-2'}`}>{block.text}</h2>;
    case 'paragraph':
      return <p className="text-[15px] leading-relaxed text-foreground/90">{block.text}</p>;
    case 'image':
      return (
        <figure className="-mx-4 md:mx-0 my-2 animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="relative aspect-[16/9] w-full overflow-hidden md:rounded-xl bg-muted">
            <ImageWithFallback src={block.src} alt={block.alt || ''} fill sizes="(min-width:768px) 720px, 100vw" className="object-cover" />
          </div>
          {block.caption && <figcaption className="px-4 md:px-0 mt-2 text-xs text-muted-foreground">{block.caption}</figcaption>}
        </figure>
      );
    case 'callout': {
      const { Icon, cls, iconCls } = CALLOUT_STYLES[block.tone];
      return (
        <div className={`flex gap-3 rounded-xl border p-4 ${cls}`}>
          <div className={`${iconCls} shrink-0 mt-0.5`}><Icon className="size-5" /></div>
          <div>
            {block.title && <div className="font-semibold text-sm">{block.title}</div>}
            <div className="text-sm text-foreground/90 mt-0.5">{block.body}</div>
          </div>
        </div>
      );
    }
    case 'checklist':
      return <Checklist title={block.title} items={block.items} />;
    case 'keyPoints':
      return (
        <div className="rounded-xl border bg-card p-4">
          {block.title && <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">{block.title}</div>}
          <ul className="space-y-1.5">
            {block.points.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 size-1.5 rounded-full bg-primary shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'divider':
      return <hr className="my-4 border-border" />;
    case 'quiz':
      return <QuizBlock block={block} answer={quizAnswer} onAnswer={onQuizAnswer} />;
  }
}

function Checklist({ title, items }: { title?: string; items: string[] }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  function toggle(i: number) {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      {title && <div className="text-sm font-semibold mb-3">{title}</div>}
      <ul className="space-y-2">
        {items.map((it, i) => {
          const on = checked.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className="w-full flex items-start gap-3 text-left text-sm group"
              >
                <span className={`mt-0.5 grid size-5 place-items-center rounded-md border transition-colors shrink-0 ${on ? 'bg-success border-success text-white' : 'border-border group-hover:border-primary'}`}>
                  {on && <Check className="size-3.5" />}
                </span>
                <span className={on ? 'line-through text-muted-foreground' : ''}>{it}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuizBlock({
  block, answer, onAnswer,
}: {
  block: Extract<ContentBlock, { type: 'quiz' }>;
  answer: number | undefined;
  onAnswer: (idx: number) => void;
}) {
  const answered = answer !== undefined;
  const correct = answer === block.correct;
  return (
    <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-1.5">Quick check</div>
      <p className="font-semibold mb-4">{block.question}</p>
      <div className="space-y-2">
        {block.options.map((opt, i) => {
          const isAnswerChoice = answer === i;
          const isCorrectChoice = i === block.correct;
          let state: 'idle' | 'right' | 'wrong' | 'reveal' = 'idle';
          if (answered) {
            if (isAnswerChoice && isCorrectChoice) state = 'right';
            else if (isAnswerChoice) state = 'wrong';
            else if (isCorrectChoice) state = 'reveal';
          }
          const cls =
            state === 'right' ? 'border-success bg-success/10 text-success font-semibold'
            : state === 'wrong' ? 'border-destructive bg-destructive/10 text-destructive'
            : state === 'reveal' ? 'border-success/60 bg-success/5 text-success'
            : isAnswerChoice ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40';
          return (
            <button
              key={i}
              type="button"
              onClick={() => !answered && onAnswer(i)}
              disabled={answered}
              className={`w-full flex items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left text-sm transition-all ${cls}`}
            >
              <span className="grid size-6 place-items-center rounded-full border border-current shrink-0 text-xs font-semibold">
                {state === 'right' || state === 'reveal' ? <Check className="size-3.5" /> : state === 'wrong' ? <X className="size-3.5" /> : String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`mt-4 rounded-lg border p-3 text-sm ${correct ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10'}`}>
          <div className="flex items-start gap-2">
            {correct ? <CheckCircle2 className="size-4 text-success mt-0.5" /> : <AlertTriangle className="size-4 text-warning mt-0.5" />}
            <div>
              <div className="font-semibold mb-0.5">{correct ? "Nice — that's right!" : 'Not quite.'}</div>
              {block.explanation && <div className="text-foreground/85">{block.explanation}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
