'use client';
/**
 * Full-page training module editor: settings, Hindi translation, ordered
 * lessons (text / image / video / checklist), quiz questions, publish /
 * unpublish, version bump (re-certification) and delete.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowDown, ArrowLeft, ArrowUp, Eye, FileText, Image as ImageIcon, ListChecks, Loader2, Plus, Save, Trash2, Video, Languages, HelpCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ImageUploader } from '@/components/image-uploader';
import { reportApiError } from '@/lib/api-error';
import type { EditorModule } from '@/server/training/authoring';
import { AUDIENCE_LABEL, CATEGORY_LABEL, categoriesFor, type Audience } from '../labels';

type Kind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'CHECKLIST';
interface LessonDraft {
  key: string;
  id?: string;
  kind: Kind;
  title: string;
  body: string;
  mediaUrl: string;
  checklist: string;
  hiTitle: string;
  hiBody: string;
  hiChecklist: string;
}
interface QuestionDraft {
  key: string;
  id?: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  hiPrompt: string;
  hiOptions: string[];
  hiExplanation: string;
}

const KIND_META: Record<Kind, { label: string; icon: typeof FileText }> = {
  TEXT: { label: 'Text', icon: FileText },
  IMAGE: { label: 'Image', icon: ImageIcon },
  VIDEO: { label: 'Video', icon: Video },
  CHECKLIST: { label: 'Checklist', icon: ListChecks },
};

let seq = 0;
const key = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function toLessonDraft(l: EditorModule['lessons'][number]): LessonDraft {
  const hi = (l.translations as any)?.hi ?? {};
  return {
    key: key(), id: l.id, kind: l.kind as Kind, title: l.title, body: l.body, mediaUrl: l.mediaUrl ?? '',
    checklist: (l.checklistItems ?? []).join('\n'), hiTitle: hi.title ?? '', hiBody: hi.body ?? '', hiChecklist: (hi.checklistItems ?? []).join('\n'),
  };
}
function toQuestionDraft(q: EditorModule['questions'][number]): QuestionDraft {
  const hi = (q.translations as any)?.hi ?? {};
  return {
    key: key(), id: q.id, prompt: q.prompt, options: [...q.options], correctIndex: q.correctIndex, explanation: q.explanation ?? '',
    hiPrompt: hi.prompt ?? '', hiOptions: q.options.map((_, i) => hi.options?.[i] ?? ''), hiExplanation: hi.explanation ?? '',
  };
}

function settingsFrom(m: EditorModule) {
  const hi = (m.translations as any)?.hi ?? {};
  return {
    title: m.title, summary: m.summary ?? '', audience: m.audience as Audience, category: m.category as string, heroImageUrl: m.heroImageUrl ?? '',
    durationMin: String(m.durationMin), order: String(m.order), isRequired: m.isRequired, isActive: m.isActive, blocksShift: m.blocksShift,
    passMarkPct: String(m.passMarkPct), maxAttempts: m.maxAttempts == null ? '' : String(m.maxAttempts),
    retakeCooldownMin: String(m.retakeCooldownMin), dueDays: String(m.dueDays), hiTitle: hi.title ?? '', hiSummary: hi.summary ?? '',
  };
}

export function ModuleEditor({ initial, canEdit }: { initial: EditorModule; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [s, setS] = useState(() => settingsFrom(initial));
  const [lessons, setLessons] = useState<LessonDraft[]>(() => initial.lessons.map(toLessonDraft));
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => initial.questions.map(toQuestionDraft));
  const [bump, setBump] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(initial.convertedFromLegacy);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openLesson, setOpenLesson] = useState<string | null>(null);

  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => { setS((x) => ({ ...x, [k]: v })); setDirty(true); };
  const editLesson = (k: string, patch: Partial<LessonDraft>) => { setLessons((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l))); setDirty(true); };
  const editQuestion = (k: string, patch: Partial<QuestionDraft>) => { setQuestions((qs) => qs.map((q) => (q.key === k ? { ...q, ...patch } : q))); setDirty(true); };
  const move = <T,>(arr: T[], i: number, d: -1 | 1) => { const n = arr.slice(); const j = i + d; if (j < 0 || j >= n.length) return arr; [n[i], n[j]] = [n[j], n[i]]; return n; };

  const categories = useMemo(() => {
    const base = categoriesFor(s.audience);
    return base.includes(s.category) ? base : [s.category, ...base];
  }, [s.audience, s.category]);

  function buildPayload(overrides: { isActive?: boolean } = {}) {
    const num = (v: string, d: number) => (v.trim() === '' || !Number.isFinite(Number(v)) ? d : Math.round(Number(v)));
    return {
      title: s.title.trim(),
      summary: s.summary.trim() || null,
      audience: s.audience,
      category: s.category,
      heroImageUrl: s.heroImageUrl.trim() || null,
      durationMin: num(s.durationMin, 10),
      order: num(s.order, 0),
      isRequired: s.isRequired,
      isActive: overrides.isActive ?? s.isActive,
      blocksShift: s.audience === 'RIDER' && s.blocksShift,
      passMarkPct: num(s.passMarkPct, 80),
      maxAttempts: s.maxAttempts.trim() === '' ? null : num(s.maxAttempts, 3),
      retakeCooldownMin: num(s.retakeCooldownMin, 0),
      dueDays: num(s.dueDays, 7),
      translations: { hi: { title: s.hiTitle.trim() || undefined, summary: s.hiSummary.trim() || undefined } },
      lessons: lessons.map((l) => ({
        id: l.id,
        kind: l.kind,
        title: l.title.trim(),
        body: l.body,
        mediaUrl: l.kind === 'IMAGE' || l.kind === 'VIDEO' ? l.mediaUrl.trim() || null : null,
        checklistItems: l.kind === 'CHECKLIST' ? lines(l.checklist) : undefined,
        translations: { hi: { title: l.hiTitle.trim() || undefined, body: l.hiBody.trim() || undefined, checklistItems: lines(l.hiChecklist).length ? lines(l.hiChecklist) : undefined } },
      })),
      questions: questions.map((q) => ({
        id: q.id,
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()),
        correctIndex: q.correctIndex,
        explanation: q.explanation.trim() || null,
        translations: {
          hi: {
            prompt: q.hiPrompt.trim() || undefined,
            options: q.hiOptions.some((o) => o.trim()) ? q.hiOptions.map((o) => o.trim()) : undefined,
            explanation: q.hiExplanation.trim() || undefined,
          },
        },
      })),
      bumpVersion: bump,
    };
  }

  async function save(overrides: { isActive?: boolean } = {}) {
    setBusy(true);
    const r = await fetch(`/api/platform/training-modules/${saved.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(overrides)),
    });
    setBusy(false);
    if (!r.ok) return void (await reportApiError(r, 'Save failed'));
    const { editor } = (await r.json()) as { editor: EditorModule };
    setSaved(editor);
    setS(settingsFrom(editor));
    setLessons(editor.lessons.map(toLessonDraft));
    setQuestions(editor.questions.map(toQuestionDraft));
    setBump(false);
    setDirty(false);
    toast.success(bump ? `Saved as version ${editor.version}. Learners must re-certify.` : overrides.isActive !== undefined ? (overrides.isActive ? 'Published' : 'Unpublished') : 'Saved');
    router.refresh();
  }

  async function del() {
    setBusy(true);
    const r = await fetch(`/api/platform/training-modules/${saved.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) return void (await reportApiError(r, 'Delete failed'));
    toast.success('Module deleted');
    router.push('/platform/training-modules');
  }

  const ro = !canEdit;

  return (
    <div className="max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/platform/training-modules" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Training library
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/platform/training-modules/${saved.id}/preview`} target="_blank"><Eye className="size-4" /> Preview as learner</Link>
          </Button>
          {canEdit && (
            <>
              <Button size="sm" variant="outline" onClick={() => save({ isActive: !saved.isActive })} disabled={busy}>
                {saved.isActive ? 'Unpublish' : 'Publish'}
              </Button>
              <Button size="sm" onClick={() => save()} disabled={busy || !dirty}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
              </Button>
            </>
          )}
        </div>
      </div>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={saved.isActive ? 'success' : 'muted'}>{saved.isActive ? 'Published' : 'Draft'}</Badge>
          <Badge variant="muted">Version {saved.version}</Badge>
          <span className="text-xs text-muted-foreground">since {new Date(saved.versionPublishedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
          {saved.slug && <span className="font-mono text-[11px] text-muted-foreground">{saved.slug}</span>}
          {dirty && canEdit && <Badge variant="warning">Unsaved changes</Badge>}
        </div>
        <h1 className="display text-2xl font-semibold sm:text-3xl">{s.title || 'Untitled module'}</h1>
        {saved.convertedFromLegacy && (
          <p className="text-xs text-muted-foreground">This module used the old single-page format. Its content was split into lessons below. Save to keep the new structure.</p>
        )}
        {!canEdit && <p className="text-xs text-muted-foreground">Read-only: only a super-admin can edit training content.</p>}
      </header>

      <fieldset disabled={ro} className="space-y-5">
        <Card>
          <CardContent className="space-y-4 p-4">
            <h2 className="font-semibold">Settings</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title"><Input value={s.title} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="Summary"><Input value={s.summary} onChange={(e) => set('summary', e.target.value)} placeholder="One line shown on the module card" /></Field>
              <Field label="Audience">
                <select value={s.audience} onChange={(e) => { const a = e.target.value as Audience; setS((x) => ({ ...x, audience: a, category: categoriesFor(a)[0], blocksShift: a === 'RIDER' && x.blocksShift })); setDirty(true); }} className="h-10 w-full rounded-md border bg-card px-2 text-sm">
                  {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
                </select>
              </Field>
              <Field label="Category">
                <select value={s.category} onChange={(e) => set('category', e.target.value)} className="h-10 w-full rounded-md border bg-card px-2 text-sm">
                  {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Minutes"><Input type="number" inputMode="numeric" min={1} value={s.durationMin} onChange={(e) => set('durationMin', e.target.value)} /></Field>
              <Field label="Order"><Input type="number" inputMode="numeric" min={0} value={s.order} onChange={(e) => set('order', e.target.value)} /></Field>
              <Field label="Pass mark %"><Input type="number" inputMode="numeric" min={0} max={100} value={s.passMarkPct} onChange={(e) => set('passMarkPct', e.target.value)} /></Field>
              <Field label="Max attempts"><Input type="number" inputMode="numeric" min={1} placeholder="Unlimited" value={s.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value)} /></Field>
              <Field label="Retake wait (min)"><Input type="number" inputMode="numeric" min={0} value={s.retakeCooldownMin} onChange={(e) => set('retakeCooldownMin', e.target.value)} /></Field>
              <Field label="Due in (days)"><Input type="number" inputMode="numeric" min={0} value={s.dueDays} onChange={(e) => set('dueDays', e.target.value)} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="Required" hint="Learners in this audience must complete it." checked={s.isRequired} onChange={(v) => set('isRequired', v)} />
              {s.audience === 'RIDER' && (
                <Toggle label="Blocks going online" hint="Safety-critical. Enforced only when the platform shift gate is on." checked={s.blocksShift} onChange={(v) => set('blocksShift', v)} />
              )}
            </div>
            <Field label="Cover image (optional)">
              <ImageUploader value={s.heroImageUrl || null} onChange={(u) => set('heroImageUrl', u ?? '')} folder="training/hero" aspect="video" recommended="1600×900 px landscape" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Languages className="size-4" /> Hindi (हिन्दी)</h2>
            <p className="text-xs text-muted-foreground">Optional. Any field left blank falls back to English. Learners switch language in the app.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title (hi)"><Input value={s.hiTitle} onChange={(e) => set('hiTitle', e.target.value)} /></Field>
              <Field label="Summary (hi)"><Input value={s.hiSummary} onChange={(e) => set('hiSummary', e.target.value)} /></Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Lessons ({lessons.length})</h2>
              <div className="ml-auto flex flex-wrap gap-1">
                {(Object.keys(KIND_META) as Kind[]).map((k) => {
                  const Icon = KIND_META[k].icon;
                  return (
                    <Button key={k} type="button" size="sm" variant="outline" onClick={() => {
                      const d: LessonDraft = { key: key(), kind: k, title: '', body: '', mediaUrl: '', checklist: '', hiTitle: '', hiBody: '', hiChecklist: '' };
                      setLessons((ls) => [...ls, d]); setOpenLesson(d.key); setDirty(true);
                    }}>
                      <Plus className="size-3.5" /><Icon className="size-3.5" /> {KIND_META[k].label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Lesson text supports <code>## Heading</code>, <code>- bullets</code>, <code>1. steps</code>, <code>**bold**</code>, <code>*italic*</code> and <code>[links](https://…)</code>.
            </p>
            {lessons.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No lessons yet. Add one above.</p>}
            <ol className="space-y-2">
              {lessons.map((l, i) => {
                const Icon = KIND_META[l.kind].icon;
                const open = openLesson === l.key;
                return (
                  <li key={l.key} className="rounded-lg border">
                    <div className="flex items-center gap-2 p-2">
                      <button type="button" onClick={() => setOpenLesson(open ? null : l.key)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                        <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{l.title || <span className="text-muted-foreground">Untitled lesson</span>}</span>
                        {l.hiTitle && <Badge variant="secondary" className="text-[10px]">hi</Badge>}
                      </button>
                      <IconBtn label="Move up" onClick={() => { setLessons((ls) => move(ls, i, -1)); setDirty(true); }}><ArrowUp className="size-4" /></IconBtn>
                      <IconBtn label="Move down" onClick={() => { setLessons((ls) => move(ls, i, 1)); setDirty(true); }}><ArrowDown className="size-4" /></IconBtn>
                      <IconBtn label="Delete lesson" onClick={() => { setLessons((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true); }}><Trash2 className="size-4 text-destructive" /></IconBtn>
                    </div>
                    {open && (
                      <div className="space-y-3 border-t p-3">
                        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                          <Field label="Type">
                            <select value={l.kind} onChange={(e) => editLesson(l.key, { kind: e.target.value as Kind })} className="h-10 w-full rounded-md border bg-card px-2 text-sm">
                              {(Object.keys(KIND_META) as Kind[]).map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
                            </select>
                          </Field>
                          <Field label="Title"><Input value={l.title} onChange={(e) => editLesson(l.key, { title: e.target.value })} /></Field>
                        </div>
                        {l.kind === 'IMAGE' && (
                          <Field label="Image">
                            <ImageUploader value={l.mediaUrl || null} onChange={(u) => editLesson(l.key, { mediaUrl: u ?? '' })} folder="training/lessons" aspect="video" recommended="1600×900 px" />
                          </Field>
                        )}
                        {l.kind === 'VIDEO' && (
                          <Field label="Video URL (YouTube, Vimeo or .mp4)">
                            <Input value={l.mediaUrl} onChange={(e) => editLesson(l.key, { mediaUrl: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" />
                          </Field>
                        )}
                        <Field label={l.kind === 'TEXT' ? 'Lesson text (markdown)' : 'Text (optional)'}>
                          <Textarea value={l.body} onChange={(e) => editLesson(l.key, { body: e.target.value })} className="min-h-[160px] font-mono text-xs" />
                        </Field>
                        {l.kind === 'CHECKLIST' && (
                          <Field label="Checklist items (one per line)">
                            <Textarea value={l.checklist} onChange={(e) => editLesson(l.key, { checklist: e.target.value })} className="min-h-[100px]" />
                          </Field>
                        )}
                        <details className="rounded-md border p-3">
                          <summary className="cursor-pointer text-sm font-medium">Hindi translation</summary>
                          <div className="mt-3 space-y-3">
                            <Field label="Title (hi)"><Input value={l.hiTitle} onChange={(e) => editLesson(l.key, { hiTitle: e.target.value })} /></Field>
                            <Field label="Text (hi)"><Textarea value={l.hiBody} onChange={(e) => editLesson(l.key, { hiBody: e.target.value })} className="min-h-[120px] text-sm" /></Field>
                            {l.kind === 'CHECKLIST' && (
                              <Field label="Checklist items (hi), same count as English"><Textarea value={l.hiChecklist} onChange={(e) => editLesson(l.key, { hiChecklist: e.target.value })} /></Field>
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 font-semibold"><HelpCircle className="size-4" /> Quiz ({questions.length} questions)</h2>
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => {
                setQuestions((qs) => [...qs, { key: key(), prompt: '', options: ['', '', ''], correctIndex: 0, explanation: '', hiPrompt: '', hiOptions: ['', '', ''], hiExplanation: '' }]);
                setDirty(true);
              }}>
                <Plus className="size-3.5" /> Question
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Single-answer multiple choice. Leave the quiz empty to certify on lesson completion alone.</p>
            <ol className="space-y-3">
              {questions.map((q, i) => (
                <li key={q.key} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <span className="pt-2.5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                    <Input value={q.prompt} onChange={(e) => editQuestion(q.key, { prompt: e.target.value })} placeholder="Question" className="flex-1" />
                    <IconBtn label="Move up" onClick={() => { setQuestions((qs) => move(qs, i, -1)); setDirty(true); }}><ArrowUp className="size-4" /></IconBtn>
                    <IconBtn label="Move down" onClick={() => { setQuestions((qs) => move(qs, i, 1)); setDirty(true); }}><ArrowDown className="size-4" /></IconBtn>
                    <IconBtn label="Delete question" onClick={() => { setQuestions((qs) => qs.filter((x) => x.key !== q.key)); setDirty(true); }}><Trash2 className="size-4 text-destructive" /></IconBtn>
                  </div>
                  <div className="space-y-2 pl-5">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input type="radio" name={`correct-${q.key}`} checked={q.correctIndex === oi} onChange={() => editQuestion(q.key, { correctIndex: oi })} aria-label={`Option ${oi + 1} is correct`} />
                        <Input value={opt} onChange={(e) => editQuestion(q.key, { options: q.options.map((o, j) => (j === oi ? e.target.value : o)) })} placeholder={`Option ${oi + 1}`} className="h-9 flex-1" />
                        {q.options.length > 2 && (
                          <IconBtn label="Remove option" onClick={() => editQuestion(q.key, {
                            options: q.options.filter((_, j) => j !== oi),
                            hiOptions: q.hiOptions.filter((_, j) => j !== oi),
                            correctIndex: q.correctIndex === oi ? 0 : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex,
                          })}><Trash2 className="size-3.5" /></IconBtn>
                        )}
                      </div>
                    ))}
                    {q.options.length < 6 && (
                      <button type="button" className="text-xs font-medium text-primary" onClick={() => editQuestion(q.key, { options: [...q.options, ''], hiOptions: [...q.hiOptions, ''] })}>+ Add option</button>
                    )}
                    <p className="text-[11px] text-muted-foreground">Select the radio next to the correct answer.</p>
                    <Field label="Explanation (shown after answering)">
                      <Input value={q.explanation} onChange={(e) => editQuestion(q.key, { explanation: e.target.value })} />
                    </Field>
                    <details className="rounded-md border p-3">
                      <summary className="cursor-pointer text-sm font-medium">Hindi translation</summary>
                      <div className="mt-3 space-y-2">
                        <Input value={q.hiPrompt} onChange={(e) => editQuestion(q.key, { hiPrompt: e.target.value })} placeholder="Question (hi)" />
                        {q.options.map((_, oi) => (
                          <Input key={oi} value={q.hiOptions[oi] ?? ''} onChange={(e) => editQuestion(q.key, { hiOptions: q.options.map((__, j) => (j === oi ? e.target.value : q.hiOptions[j] ?? '')) })} placeholder={`Option ${oi + 1} (hi)`} className="h-9" />
                        ))}
                        <Input value={q.hiExplanation} onChange={(e) => editQuestion(q.key, { hiExplanation: e.target.value })} placeholder="Explanation (hi)" />
                      </div>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </fieldset>

      {canEdit && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1" checked={bump} onChange={(e) => { setBump(e.target.checked); setDirty(true); }} />
              <span>
                <span className="block text-sm font-medium">Save as a new version (v{saved.version + 1})</span>
                <span className="block text-xs text-muted-foreground">
                  Use this for material changes. Everyone certified on v{saved.version} must redo the lessons and quiz. Their old certificates stay on record.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              {confirmDelete ? (
                <>
                  <span className="text-xs text-muted-foreground">Delete permanently, including all progress and certificates for this module?</span>
                  <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</Button>
                  <Button size="sm" variant="destructive" onClick={del} disabled={busy}>Delete module</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-4" /> Delete
                </Button>
              )}
              <Button className="ml-auto" onClick={() => save()} disabled={busy || !dirty}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {bump ? `Save as v${saved.version + 1}` : 'Save changes'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-accent">
      {children}
    </button>
  );
}
