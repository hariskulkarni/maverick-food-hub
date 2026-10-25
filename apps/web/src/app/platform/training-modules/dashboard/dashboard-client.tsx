'use client';
/**
 * Training completion dashboard: per-module stats (certified, pass rate,
 * average score, overdue) and a learner table with per-module status,
 * search / overdue filter, CSV export and super-admin attempt reset.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { reportApiError } from '@/lib/api-error';
import type { ReportCellState, TrainingReport } from '@/server/training/report';
import { AUDIENCE_LABEL, type Audience } from '../labels';

const TABS: (Audience | 'ALL')[] = ['RIDER', 'KITCHEN', 'RESTAURANT_ADMIN', 'ALL'];

const CELL: Record<ReportCellState, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' | 'secondary' }> = {
  CERTIFIED: { label: 'Certified', variant: 'success' },
  QUIZ_READY: { label: 'Quiz pending', variant: 'warning' },
  IN_PROGRESS: { label: 'In progress', variant: 'warning' },
  NOT_STARTED: { label: 'Not started', variant: 'muted' },
  RECERT_REQUIRED: { label: 'Re-certify', variant: 'destructive' },
  NOT_ASSIGNED: { label: '—', variant: 'secondary' },
};

export function TrainingDashboardClient({
  report,
  audience,
  canReset,
}: {
  report: TrainingReport;
  audience: Audience | 'ALL';
  canReset: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const learners = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return report.learners
      .filter((l) => (!overdueOnly || l.overdue > 0) && (!ql || `${l.name} ${l.phone ?? ''} ${l.restaurant ?? ''}`.toLowerCase().includes(ql)))
      .sort((a, b) => b.overdue - a.overdue || a.requiredCertified / (a.requiredTotal || 1) - b.requiredCertified / (b.requiredTotal || 1));
  }, [report.learners, q, overdueOnly]);

  const fullyDone = report.learners.filter((l) => l.requiredTotal > 0 && l.requiredCertified === l.requiredTotal).length;
  const withOverdue = report.learners.filter((l) => l.overdue > 0).length;

  async function reset(moduleId: string, userId: string) {
    const r = await fetch(`/api/platform/training-modules/${moduleId}/reset-attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!r.ok) return void (await reportApiError(r, 'Reset failed'));
    const { removed } = await r.json();
    toast.success(removed ? `Cleared ${removed} failed attempt${removed === 1 ? '' : 's'}` : 'No failed attempts to clear');
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`?audience=${t}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${audience === t ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
          >
            {t === 'ALL' ? 'Everyone' : AUDIENCE_LABEL[t]}
          </Link>
        ))}
        <a
          href={`/api/platform/training-modules/report?audience=${audience}&format=csv`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
        >
          <Download className="size-3.5" /> Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Learners" value={report.learners.length} />
        <Kpi label="All required done" value={fullyDone} />
        <Kpi label="With overdue modules" value={withOverdue} tone={withOverdue ? 'bad' : undefined} />
        <Kpi label="Modules" value={report.modules.length} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Module</th>
                  <th className="px-4 py-2.5 font-medium">Certified</th>
                  <th className="px-4 py-2.5 font-medium">Pass rate</th>
                  <th className="px-4 py-2.5 font-medium">Avg score</th>
                  <th className="px-4 py-2.5 font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.modules.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <Link href={`/platform/training-modules/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                      <div className="text-[11px] text-muted-foreground">
                        {AUDIENCE_LABEL[m.audience]} · v{m.version}{m.isRequired ? ' · required' : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {m.certified}/{m.learners}
                      {m.learners > 0 && <span className="text-muted-foreground"> ({Math.round((m.certified / m.learners) * 100)}%)</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{m.passRatePct === null ? '—' : `${m.passRatePct}%`} <span className="text-[11px] text-muted-foreground">({m.attempts} attempts)</span></td>
                    <td className="px-4 py-3 tabular-nums">{m.avgScorePct === null ? '—' : `${m.avgScorePct}%`}</td>
                    <td className="px-4 py-3">{m.overdue > 0 ? <Badge variant="destructive">{m.overdue}</Badge> : <span className="text-muted-foreground">0</span>}</td>
                  </tr>
                ))}
                {report.modules.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No published modules for this audience.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-md sm:w-auto sm:flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, restaurant" className="pl-9" />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={overdueOnly} onCheckedChange={setOverdueOnly} /> Overdue only
            </label>
            <span className="ml-auto text-xs text-muted-foreground">{learners.length} learner{learners.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Learner</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Required done</th>
                  <th className="px-4 py-2.5 font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {learners.slice(0, 500).map((l) => (
                  <FragmentRow key={l.userId}>
                    <tr className="cursor-pointer hover:bg-muted/30" onClick={() => setOpen(open === l.userId ? null : l.userId)}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{l.name}</div>
                        <div className="text-[11px] text-muted-foreground">{[l.phone, l.restaurant].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{AUDIENCE_LABEL[l.audience]}</td>
                      <td className="px-4 py-3 tabular-nums">{l.requiredCertified}/{l.requiredTotal}</td>
                      <td className="px-4 py-3">{l.overdue > 0 ? <Badge variant="destructive">{l.overdue}</Badge> : <span className="text-muted-foreground">0</span>}</td>
                    </tr>
                    {open === l.userId && (
                      <tr className="bg-muted/20">
                        <td colSpan={4} className="px-4 py-3">
                          <ul className="space-y-2">
                            {report.modules.map((m) => {
                              const c = l.cells[m.id];
                              if (!c || c.state === 'NOT_ASSIGNED') return null;
                              const meta = CELL[c.state];
                              return (
                                <li key={m.id} className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="min-w-0 flex-1 font-medium">{m.title}</span>
                                  <Badge variant={c.overdue ? 'destructive' : meta.variant} className="text-[10px]">{c.overdue ? `${meta.label} · overdue` : meta.label}</Badge>
                                  <span className="text-muted-foreground">
                                    {c.bestScorePct !== null ? `best ${c.bestScorePct}% · ` : ''}{c.attempts} attempt{c.attempts === 1 ? '' : 's'}
                                    {c.certifiedAt ? ` · cert v${c.certVersion} ${c.certifiedAt.slice(0, 10)}` : ''}
                                  </span>
                                  {canReset && c.attempts > 0 && c.state !== 'CERTIFIED' && (
                                    <button type="button" onClick={() => reset(m.id, l.userId)} className="inline-flex items-center gap-1 rounded border px-2 py-1 font-medium hover:bg-accent">
                                      <RotateCcw className="size-3" /> Reset attempts
                                    </button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                ))}
                {learners.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No learners match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {learners.length > 500 && <p className="text-xs text-muted-foreground">Showing the first 500. Export CSV for the full list.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${tone === 'bad' ? 'text-destructive' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
