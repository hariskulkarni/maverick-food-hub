'use client';
/**
 * Learner training library (restaurant staff on web): required + optional
 * sections with progress, a "required training" banner, and certificates.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Award, BookOpen, CheckCircle2, ChevronRight, Clock, GraduationCap, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { useTrainingLang, type TrainingLang } from './use-training-lang';

interface LibraryModule {
  id: string;
  title: string;
  summary: string | null;
  durationMin: number;
  isRequired: boolean;
  version: number;
  languages: string[];
  lessonsCount: number;
  questionCount: number;
  completed: boolean;
  status: { state: string; progressPct: number; needsRecert: boolean; overdue: boolean; dueAt: string | null };
}

interface Library {
  modules: LibraryModule[];
  completedCount: number;
  totalCount: number;
  requiredRemaining: number;
  requiredOverdue: number;
  recertRequired: number;
}

interface Certificate {
  id: string;
  code: string;
  moduleId: string;
  moduleTitle: string;
  moduleVersion: number;
  isCurrent: boolean;
  scorePct: number | null;
  issuedAt: string;
}

const STATE_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  QUIZ_READY: 'Quiz pending',
  CERTIFIED: 'Certified',
  RECERT_REQUIRED: 'Re-certify',
};

export function TrainingLibrary({ apiBase, moduleBase }: { apiBase: string; moduleBase: string }) {
  const [lang, setLang] = useTrainingLang();
  const [tab, setTab] = useState<'library' | 'certificates'>('library');
  const [lib, setLib] = useState<Library | null>(null);
  const [certs, setCerts] = useState<Certificate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [a, b] = await Promise.all([
      fetch(`${apiBase}?lang=${lang}`, { cache: 'no-store' }),
      fetch(`${apiBase}/certificates?lang=${lang}`, { cache: 'no-store' }),
    ]);
    if (!a.ok) {
      const body = await a.json().catch(() => ({}));
      setError(body.error ?? 'Could not load your training.');
      return;
    }
    setLib(await a.json());
    if (b.ok) setCerts((await b.json()).certificates);
  }, [apiBase, lang]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="size-4" /> Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (!lib) return <div className="grid place-items-center p-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;

  const required = lib.modules.filter((m) => m.isRequired);
  const optional = lib.modules.filter((m) => !m.isRequired);
  const hasHindi = lib.modules.some((m) => m.languages.includes('hi'));

  return (
    <div className="space-y-5">
      {lib.requiredRemaining > 0 && (
        <div className={cn('flex items-start gap-3 rounded-xl border p-4', lib.requiredOverdue > 0 ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10')}>
          <AlertTriangle className={cn('mt-0.5 size-5 shrink-0', lib.requiredOverdue > 0 ? 'text-destructive' : 'text-warning')} />
          <div className="text-sm">
            <div className="font-semibold">
              {lib.requiredRemaining} required module{lib.requiredRemaining === 1 ? '' : 's'} to complete
              {lib.requiredOverdue > 0 ? ` · ${lib.requiredOverdue} overdue` : ''}
            </div>
            {lib.recertRequired > 0 && (
              <div className="text-muted-foreground">
                {lib.recertRequired} module{lib.recertRequired === 1 ? ' was' : 's were'} updated. Please re-certify.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['library', 'certificates'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', tab === t ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent')}
          >
            {t === 'library' ? `Library (${lib.completedCount}/${lib.totalCount})` : `Certificates (${certs?.length ?? 0})`}
          </button>
        ))}
        {hasHindi && (
          <div className="ml-auto flex gap-1">
            {(['en', 'hi'] as TrainingLang[]).map((l) => (
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
        )}
      </div>

      {tab === 'library' ? (
        lib.modules.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No training assigned yet" description="Flavrly will publish modules for your role here." />
        ) : (
          <>
            <Section title="Required" modules={required} moduleBase={moduleBase} />
            <Section title="Optional" modules={optional} moduleBase={moduleBase} />
          </>
        )
      ) : (
        <Certificates certs={certs ?? []} />
      )}
    </div>
  );
}

function Section({ title, modules, moduleBase }: { title: string; modules: LibraryModule[]; moduleBase: string }) {
  if (modules.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {modules.map((m) => (
          <Link key={m.id} href={`${moduleBase}/${m.id}`} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', m.completed ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary')}>
                    {m.completed ? <CheckCircle2 className="size-5" /> : <BookOpen className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-snug">{m.title}</div>
                    {m.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.summary}</p>}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full', m.completed ? 'bg-success' : 'bg-primary')} style={{ width: `${m.status.progressPct}%` }} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {m.durationMin} min</span>
                  <span>· {m.lessonsCount} lessons{m.questionCount ? ` · ${m.questionCount}-question quiz` : ''}</span>
                  <Badge variant={m.completed ? 'success' : m.status.needsRecert || m.status.overdue ? 'destructive' : 'muted'} className="ml-auto text-[10px]">
                    {m.status.overdue && !m.completed ? 'Overdue' : STATE_LABEL[m.status.state] ?? m.status.state}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Certificates({ certs }: { certs: Certificate[] }) {
  if (certs.length === 0) {
    return <EmptyState icon={Award} title="No certificates yet" description="Finish a module (and pass its quiz) to earn a certificate." />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {certs.map((c) => (
        <Card key={c.id} className={c.isCurrent ? 'border-success/40' : 'opacity-70'}>
          <CardContent className="flex items-start gap-3 p-4">
            <Award className={cn('size-8 shrink-0', c.isCurrent ? 'text-success' : 'text-muted-foreground')} />
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{c.moduleTitle}</div>
              <div className="text-xs text-muted-foreground">
                Issued {new Date(c.issuedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · version {c.moduleVersion}
                {c.scorePct !== null ? ` · ${c.scorePct}%` : ''}
              </div>
              <div className="mt-1 font-mono text-xs">{c.code}</div>
              {!c.isCurrent && <div className="mt-1 text-xs text-destructive">Superseded by a newer version. Re-certify to stay current.</div>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
