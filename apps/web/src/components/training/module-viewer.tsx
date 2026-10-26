'use client';
/**
 * Learner view of one training module: lesson stepper → quiz → results /
 * retake → certificate. Used by restaurant staff (/admin/training,
 * /kitchen/training) against `/api/staff/training`, and by the platform
 * "preview as learner" page in `preview` mode (no writes; graded locally).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, Award, CheckCircle2, ChevronRight, Circle, Clock, HelpCircle, Loader2, RotateCcw, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/api-error';
import { LessonContent, type LessonView } from './lesson-content';
import { useTrainingLang, type TrainingLang } from './use-training-lang';

export interface ViewerModule {
  id: string;
  title: string;
  summary: string | null;
  durationMin: number;
  isRequired: boolean;
  version: number;
  languages: string[];
  lessons: LessonView[];
  completedLessonIds: string[];
  quiz: {
    questions: { id: string; prompt: string; options: string[] }[];
    passMarkPct: number;
    maxAttempts: number | null;
    retakeCooldownMin: number;
    eligibility: { allowed: boolean; reason: string | null; attemptsUsed: number; attemptsLeft: number | null; retryAt: string | null };
    lastAttempt: { scorePct: number; passed: boolean; createdAt: string } | null;
  } | null;
  status: {
    state: string;
    progressPct: number;
    lessonsDone: number;
    lessonsTotal: number;
    needsRecert: boolean;
    overdue: boolean;
    dueAt: string | null;
    certificateCode: string | null;
  };
  completedAt: string | null;
}

interface QuizResult {
  scorePct: number;
  correctCount: number;
  totalCount: number;
  passed: boolean;
  passMarkPct: number;
  questions: { questionId: string; chosenIndex: number | null; correct: boolean; correctIndex: number | null; explanation: string | null }[];
}

export interface PreviewData {
  module: ViewerModule;
  answerKey: Record<string, { correctIndex: number; explanation: string | null }>;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function initialStep(m: ViewerModule): number {
  const done = new Set(m.completedLessonIds);
  const firstOpen = m.lessons.findIndex((l) => !done.has(l.id));
  if (firstOpen >= 0) return firstOpen;
  return m.quiz && m.status.state !== 'CERTIFIED' ? m.lessons.length : 0;
}

export function ModuleViewer({
  apiBase,
  moduleId,
  backHref,
  preview,
}: {
  apiBase: string;
  moduleId: string;
  backHref: string;
  preview?: PreviewData;
}) {
  const [lang, setLang] = useTrainingLang();
  const [mod, setMod] = useState<ViewerModule | null>(preview?.module ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (preview) return;
    setLoadError(null);
    const r = await fetch(`${apiBase}/${moduleId}?lang=${lang}`, { cache: 'no-store' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setLoadError(body.error ?? 'Could not load this module.');
      return;
    }
    const data = (await r.json()) as ViewerModule;
    setMod(data);
    return data;
  }, [apiBase, moduleId, lang, preview]);

  useEffect(() => {
    if (preview) {
      setStep(initialStep(preview.module));
      return;
    }
    load().then((d) => d && setStep((s) => (s === 0 ? initialStep(d) : s)));
  }, [load, preview]);

  const completed = useMemo(() => new Set(mod?.completedLessonIds ?? []), [mod]);

  if (loadError) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => load()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (!mod) {
    return <div className="grid place-items-center p-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  const onQuiz = !!mod.quiz && step >= mod.lessons.length;
  const lesson = onQuiz ? null : mod.lessons[step] ?? null;
  const certified = mod.status.state === 'CERTIFIED';

  async function markLessonDone() {
    if (!lesson || !mod) return;
    if (preview) {
      setMod({ ...mod, completedLessonIds: [...new Set([...mod.completedLessonIds, lesson.id])] });
      setStep(step + 1 < mod.lessons.length || mod.quiz ? step + 1 : step);
      return;
    }
    setBusy(true);
    const r = await fetch(`${apiBase}/${mod.id}/lessons/${lesson.id}?lang=${lang}`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) return void (await reportApiError(r, 'Could not save progress'));
    const { module: fresh } = (await r.json()) as { module: ViewerModule };
    setMod(fresh);
    if (fresh.status.state === 'CERTIFIED' && !fresh.quiz && step === fresh.lessons.length - 1) {
      toast.success('Module complete. Your certificate is ready.');
      return;
    }
    if (step + 1 < fresh.lessons.length || fresh.quiz) setStep(step + 1);
  }

  async function completeEmpty() {
    if (!mod || preview) return;
    setBusy(true);
    const r = await fetch(`${apiBase}/${mod.id}`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) return void (await reportApiError(r, 'Could not complete module'));
    await load();
  }

  async function submit() {
    if (!mod?.quiz) return;
    if (preview) {
      const qs = mod.quiz.questions.map((q) => {
        const key = preview.answerKey[q.id];
        const chosen = answers[q.id] ?? null;
        const correct = chosen !== null && chosen === key?.correctIndex;
        return { questionId: q.id, chosenIndex: chosen, correct, correctIndex: key?.correctIndex ?? null, explanation: key?.explanation ?? null };
      });
      const correctCount = qs.filter((q) => q.correct).length;
      const scorePct = qs.length ? Math.round((correctCount / qs.length) * 100) : 100;
      setResult({ scorePct, correctCount, totalCount: qs.length, passed: scorePct >= mod.quiz.passMarkPct, passMarkPct: mod.quiz.passMarkPct, questions: qs });
      return;
    }
    setBusy(true);
    const r = await fetch(`${apiBase}/${mod.id}/quiz?lang=${lang}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    setBusy(false);
    if (!r.ok) {
      await reportApiError(r, 'Quiz not submitted');
      await load();
      return;
    }
    const data = (await r.json()) as { result: QuizResult; module: ViewerModule };
    setResult(data.result);
    setMod(data.module);
    if (data.result.passed) toast.success(`Passed with ${data.result.scorePct}%. Certificate issued.`);
  }

  function retake() {
    setResult(null);
    setAnswers({});
    if (!preview) load();
  }

  const elig = mod.quiz?.eligibility;
  const allAnswered = !!mod.quiz && mod.quiz.questions.every((q) => answers[q.id] !== undefined);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All training
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {!preview && mod.languages.length > 1 &&
            (['en', 'hi'] as TrainingLang[]).filter((l) => mod.languages.includes(l)).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium', lang === l ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
              >
                {l === 'en' ? 'English' : 'हिन्दी'}
              </button>
            ))}
        </div>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {mod.isRequired && <Badge variant="warning">Required</Badge>}
          {mod.status.needsRecert && <Badge variant="destructive">Re-certification needed</Badge>}
          {mod.status.overdue && <Badge variant="destructive">Overdue</Badge>}
          {certified && <Badge variant="success">Certified</Badge>}
          <Badge variant="muted">v{mod.version}</Badge>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" /> {mod.durationMin} min</span>
        </div>
        <h1 className="display text-2xl font-semibold sm:text-3xl">{mod.title}</h1>
        {mod.summary && <p className="text-sm text-muted-foreground">{mod.summary}</p>}
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${mod.status.progressPct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {mod.status.lessonsDone}/{mod.status.lessonsTotal} lessons
          {mod.quiz ? ` · quiz pass mark ${mod.quiz.passMarkPct}%` : ''}
          {mod.status.dueAt && !certified ? ` · due ${fmtDate(mod.status.dueAt)}` : ''}
        </p>
      </header>

      {certified && mod.status.certificateCode && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Award className="size-8 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Flavrly certificate · {mod.title}</div>
              <div className="text-xs text-muted-foreground">
                Code <span className="font-mono">{mod.status.certificateCode}</span> · version {mod.version}
                {mod.completedAt ? ` · issued ${fmtDate(mod.completedAt)}` : ''}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {mod.lessons.length === 0 && !mod.quiz ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">This module has no lessons yet.</p>
            {!certified && !preview && (
              <Button size="sm" onClick={completeEmpty} disabled={busy}>Mark as complete</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit">
            <CardContent className="p-2">
              <ol className="space-y-1">
                {mod.lessons.map((l, i) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => { setStep(i); setResult(null); }}
                      className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm', step === i ? 'bg-primary/10 text-primary' : 'hover:bg-accent')}
                    >
                      {completed.has(l.id) ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                      <span className="line-clamp-2">{i + 1}. {l.title}</span>
                    </button>
                  </li>
                ))}
                {mod.quiz && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setStep(mod.lessons.length)}
                      className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm', onQuiz ? 'bg-primary/10 text-primary' : 'hover:bg-accent')}
                    >
                      {certified ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <HelpCircle className="size-4 shrink-0 text-muted-foreground" />}
                      <span>Quiz · {mod.quiz.questions.length} questions</span>
                    </button>
                  </li>
                )}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-5 p-4 sm:p-6">
              {lesson && (
                <>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Lesson {step + 1} of {mod.lessons.length}
                  </div>
                  <h2 className="text-xl font-semibold">{lesson.title}</h2>
                  <LessonContent key={lesson.id} lesson={lesson} />
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
                    {completed.has(lesson.id) ? (
                      <>
                        <span className="mr-auto inline-flex items-center gap-1 text-sm text-success"><CheckCircle2 className="size-4" /> Done</span>
                        {(step + 1 < mod.lessons.length || mod.quiz) && (
                          <Button size="sm" variant="outline" onClick={() => setStep(step + 1)}>
                            Next <ChevronRight className="size-4" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button size="sm" onClick={markLessonDone} disabled={busy}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        {step + 1 < mod.lessons.length ? 'Mark done and continue' : mod.quiz ? 'Mark done and go to quiz' : 'Finish module'}
                      </Button>
                    )}
                  </div>
                </>
              )}

              {onQuiz && mod.quiz && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-xl font-semibold">Quiz</h2>
                    <span className="text-xs text-muted-foreground">
                      Pass mark {mod.quiz.passMarkPct}%
                      {mod.quiz.maxAttempts ? ` · ${elig?.attemptsLeft ?? 0} of ${mod.quiz.maxAttempts} attempts left` : ''}
                    </span>
                  </div>

                  {result ? (
                    <QuizResults mod={mod} result={result} answers={answers} onRetake={retake} />
                  ) : certified || elig?.reason === 'already_passed' ? (
                    <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                      You passed this quiz{mod.quiz.lastAttempt ? ` with ${mod.quiz.lastAttempt.scorePct}%` : ''}.
                    </p>
                  ) : !preview && elig && !elig.allowed ? (
                    <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                      {elig.reason === 'lessons_incomplete' && 'Finish every lesson to unlock the quiz.'}
                      {elig.reason === 'cooldown' && `You can try again at ${elig.retryAt ? fmtTime(elig.retryAt) : 'a little later'}. Use the time to review the lessons.`}
                      {elig.reason === 'max_attempts' && 'You have used all your attempts for this version. Contact Flavrly Support to reset them.'}
                    </p>
                  ) : (
                    <>
                      {mod.quiz.questions.map((q, qi) => (
                        <fieldset key={q.id} className="space-y-2 rounded-xl border p-4">
                          <legend className="px-1 text-sm font-semibold">{qi + 1}. {q.prompt}</legend>
                          {q.options.map((opt, oi) => (
                            <label
                              key={oi}
                              className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
                                answers[q.id] === oi ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                              )}
                            >
                              <input
                                type="radio"
                                name={q.id}
                                className="mt-0.5 accent-[hsl(var(--primary))]"
                                checked={answers[q.id] === oi}
                                onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                              />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </fieldset>
                      ))}
                      <div className="flex justify-end">
                        <Button onClick={submit} disabled={!allAnswered || busy}>
                          {busy && <Loader2 className="size-4 animate-spin" />} Submit answers
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function QuizResults({
  mod,
  result,
  answers,
  onRetake,
}: {
  mod: ViewerModule;
  result: QuizResult;
  answers: Record<string, number>;
  onRetake: () => void;
}) {
  const byId = new Map(result.questions.map((q) => [q.questionId, q]));
  return (
    <div className="space-y-4">
      <div className={cn('flex items-center gap-3 rounded-xl border p-4', result.passed ? 'border-success/40 bg-success/10' : 'border-destructive/40 bg-destructive/10')}>
        {result.passed ? <Award className="size-8 text-success" /> : <XCircle className="size-8 text-destructive" />}
        <div>
          <div className="font-semibold">{result.passed ? 'You passed!' : 'Not passed this time'}</div>
          <div className="text-sm text-muted-foreground">
            {result.correctCount}/{result.totalCount} correct · {result.scorePct}% (pass mark {result.passMarkPct}%)
          </div>
        </div>
      </div>
      <ol className="space-y-2">
        {mod.quiz!.questions.map((q, i) => {
          const r = byId.get(q.id);
          return (
            <li key={q.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start gap-2">
                {r?.correct ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <div className="min-w-0 space-y-1">
                  <div className="font-medium">{i + 1}. {q.prompt}</div>
                  <div className="text-muted-foreground">Your answer: {answers[q.id] !== undefined ? q.options[answers[q.id]] : 'No answer'}</div>
                  {r?.correctIndex !== null && r?.correctIndex !== undefined && !r.correct && (
                    <div className="text-success">Correct answer: {q.options[r.correctIndex]}</div>
                  )}
                  {r?.explanation && <div className="text-foreground/80">{r.explanation}</div>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {!result.passed && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Review the lessons, then try again.</span>
          <Button variant="outline" onClick={onRetake}><RotateCcw className="size-4" /> Retake quiz</Button>
        </div>
      )}
    </div>
  );
}
