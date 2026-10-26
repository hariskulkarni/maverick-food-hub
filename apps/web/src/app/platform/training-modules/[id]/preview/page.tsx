/**
 * Platform "preview as learner": the saved module rendered in the same viewer
 * restaurant staff use, in preview mode (nothing is recorded; the quiz is
 * graded locally with the answer key). Works for drafts and every audience.
 */
import { notFound } from 'next/navigation';
import { Eye } from 'lucide-react';
import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { loadModuleForEditor } from '@/server/training/authoring';
import { normalizeLang, localizeLesson, localizeModuleText, localizeQuestion, localizedExplanation, availableLanguages } from '@/server/training/content';
import { ModuleViewer, type PreviewData } from '@/components/training/module-viewer';
import { Badge } from '@/components/ui/badge';

export const metadata = { title: 'Platform · Training preview' };
export const dynamic = 'force-dynamic';

export default async function TrainingModulePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  await requireCapability('cms:read');
  const { id } = await params;
  const lang = normalizeLang((await searchParams).lang);
  const m = await loadModuleForEditor(prisma, id);
  if (!m) notFound();

  const lessons = m.lessons.map((l, i) =>
    localizeLesson({ id: l.id ?? `draft-${i}`, order: i, kind: l.kind, title: l.title, body: l.body, mediaUrl: l.mediaUrl ?? null, checklistItems: l.checklistItems, translations: l.translations }, lang),
  );
  const questions = m.questions.map((q, i) => ({ ...q, id: q.id ?? `draft-q${i}`, order: i, explanation: q.explanation ?? null }));
  const text = localizeModuleText(m, lang);
  const preview: PreviewData = {
    module: {
      id: m.id,
      title: text.title,
      summary: text.summary,
      durationMin: m.durationMin,
      isRequired: m.isRequired,
      version: m.version,
      languages: availableLanguages(m.translations),
      lessons,
      completedLessonIds: [],
      quiz: questions.length
        ? {
            questions: questions.map((q) => localizeQuestion(q, lang)),
            passMarkPct: m.passMarkPct,
            maxAttempts: m.maxAttempts,
            retakeCooldownMin: m.retakeCooldownMin,
            eligibility: { allowed: true, reason: null, attemptsUsed: 0, attemptsLeft: m.maxAttempts, retryAt: null },
            lastAttempt: null,
          }
        : null,
      status: { state: 'NOT_STARTED', progressPct: 0, lessonsDone: 0, lessonsTotal: lessons.length, needsRecert: false, overdue: false, dueAt: null, certificateCode: null },
      completedAt: null,
    },
    answerKey: Object.fromEntries(questions.map((q) => [q.id, { correctIndex: q.correctIndex, explanation: localizedExplanation(q, lang) }])),
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Eye className="size-4" /> Preview as learner · nothing is recorded
        {!m.isActive && <Badge variant="muted">Draft</Badge>}
        {preview.module.languages.includes('hi') && (
          <a href={`?lang=${lang === 'hi' ? 'en' : 'hi'}`} className="ml-auto font-medium text-primary">
            {lang === 'hi' ? 'View in English' : 'हिन्दी में देखें'}
          </a>
        )}
      </div>
      <ModuleViewer key={lang} apiBase="" moduleId={m.id} backHref={`/platform/training-modules/${m.id}`} preview={JSON.parse(JSON.stringify(preview))} />
    </div>
  );
}
