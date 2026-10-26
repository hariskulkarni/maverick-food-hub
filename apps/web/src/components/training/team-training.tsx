'use client';
/** Restaurant admin: training status of the staff linked to the current restaurant. */
import { useEffect, useState } from 'react';
import { Download, Loader2, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { TrainingReport } from '@/server/training/report';

export function TeamTraining() {
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/staff/training/team', { cache: 'no-store' })
      .then(async (r) => (r.ok ? setReport(await r.json()) : setError((await r.json().catch(() => ({}))).error ?? 'Could not load team training.')))
      .catch(() => setError('Could not load team training.'));
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-5" /> Your team</h2>
        {report && report.learners.length > 0 && (
          <button
            type="button"
            onClick={() => window.location.assign('/api/staff/training/team?format=csv')}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            <Download className="size-3.5" /> Export CSV
          </button>
        )}
      </div>
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : !report ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : report.learners.length === 0 ? (
        <p className="text-sm text-muted-foreground">No staff accounts are linked to this restaurant yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Required done</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.learners.map((l) => (
                    <tr key={l.userId}>
                      <td className="px-4 py-3 font-medium">{l.name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{l.audience === 'KITCHEN' ? 'Kitchen' : 'Admin'}</td>
                      <td className="px-4 py-3 tabular-nums">{l.requiredCertified}/{l.requiredTotal}</td>
                      <td className="px-4 py-3">
                        {l.requiredTotal > 0 && l.requiredCertified === l.requiredTotal ? (
                          <Badge variant="success">Complete</Badge>
                        ) : l.overdue > 0 ? (
                          <Badge variant="destructive">{l.overdue} overdue</Badge>
                        ) : (
                          <Badge variant="warning">In progress</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
