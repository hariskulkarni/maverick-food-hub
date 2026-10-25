'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Search, ChevronRight, CheckCircle2, RotateCcw } from 'lucide-react';
import { useObs, Section, LoadState, Empty, StatusPill, Kpi, fmtAgo, fmtNum, postJson, type RangeKey } from './obs-ui';

interface ErrRow {
  id: string; level: string; kind: string; source: string; message: string; digest: string | null; sampleStack: string | null;
  method: string | null; path: string | null; route: string | null; requestId: string | null; release: string | null;
  statusCode: number | null; count: number; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; area: string;
}
interface ErrResp { rows: ErrRow[]; unresolvedByKind: Record<string, number>; areas: Array<{ key: string; label: string }> }

const KIND_LABEL: Record<string, string> = { SERVER: 'Server', CLIENT: 'Browser', NATIVE: 'Rider app' };

export function ErrorsTab({ range, refreshKey }: { range: RangeKey; refreshKey: number }) {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<'false' | 'true' | ''>('false');
  const [area, setArea] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ range, limit: '150' });
  if (kind) params.set('kind', kind);
  if (status) params.set('resolved', status);
  if (area) params.set('area', area);
  if (query) params.set('q', query);
  const { data, error, loading, reload } = useObs<ErrResp>(`/api/platform/observability/errors?${params}`, refreshKey);

  const toggle = async (r: ErrRow) => {
    try {
      await postJson(`/api/platform/observability/errors/${r.id}/resolve`, { resolved: !r.resolvedAt });
      toast.success(r.resolvedAt ? 'Re-opened' : 'Marked resolved');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const by = data?.unresolvedByKind ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(['SERVER', 'CLIENT', 'NATIVE'] as const).map((k) => (
          <Kpi key={k} label={`${KIND_LABEL[k]} (open)`} value={fmtNum(by[k] ?? 0)} tone={(by[k] ?? 0) > 0 ? 'warn' : 'ok'} onClick={() => setKind(kind === k ? '' : k)} />
        ))}
      </div>
      <Section
        title="Error groups"
        actions={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q.trim());
            }}
          >
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Source">
              <option value="">All sources</option>
              <option value="SERVER">Server</option>
              <option value="CLIENT">Browser</option>
              <option value="NATIVE">Rider app</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'false' | 'true' | '')} className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Status">
              <option value="false">Open</option>
              <option value="true">Resolved</option>
              <option value="">All</option>
            </select>
            <select value={area} onChange={(e) => setArea(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm max-w-[10rem]" aria-label="Area">
              <option value="">All areas</option>
              {data?.areas.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Message, route, request id" className="pl-8 h-9" />
            </div>
          </form>
        }
      >
        <LoadState loading={loading} error={error} empty={!data}>
          {!data?.rows.length ? (
            <Empty>No errors match. Server exceptions, browser errors and rider-app crashes all land here (redacted).</Empty>
          ) : (
            <ul className="divide-y">
              {data.rows.map((r) => (
                <li key={r.id} className="py-2">
                  <div className="flex items-start gap-2">
                    <button onClick={() => setOpen(open === r.id ? null : r.id)} className="mt-0.5 shrink-0" aria-label="Toggle details">
                      <ChevronRight className={cn('h-4 w-4 transition-transform', open === r.id && 'rotate-90')} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={r.level === 'ERROR' ? 'FAILED' : 'WARNING'} label={r.level} />
                        <StatusPill status="info" label={KIND_LABEL[r.kind] ?? r.kind} />
                        {r.resolvedAt ? <StatusPill status="RESOLVED" label="resolved" /> : null}
                        <span className="text-xs text-muted-foreground">×{fmtNum(r.count)} · last {fmtAgo(r.lastSeenAt)} · first {fmtAgo(r.firstSeenAt)}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium break-words">{r.message}</div>
                      <div className="text-xs text-muted-foreground font-mono break-all">{r.route ?? r.source}</div>
                      {open === r.id ? (
                        <div className="mt-2 space-y-2 text-xs">
                          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                            <div><dt className="inline text-muted-foreground">Source: </dt><dd className="inline break-all">{r.source}</dd></div>
                            <div><dt className="inline text-muted-foreground">Path: </dt><dd className="inline break-all">{r.method ? `${r.method} ` : ''}{r.path ?? '—'}</dd></div>
                            <div><dt className="inline text-muted-foreground">Sample request id: </dt><dd className="inline font-mono break-all">{r.requestId ?? '—'}</dd></div>
                            <div><dt className="inline text-muted-foreground">Release: </dt><dd className="inline font-mono">{r.release ?? '—'}</dd></div>
                            {r.digest ? <div><dt className="inline text-muted-foreground">Digest: </dt><dd className="inline font-mono">{r.digest}</dd></div> : null}
                          </dl>
                          {r.sampleStack ? (
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">{r.sampleStack}</pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => toggle(r)} className="shrink-0">
                      {r.resolvedAt ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      <span className="hidden sm:inline">{r.resolvedAt ? 'Reopen' : 'Resolve'}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </LoadState>
      </Section>
    </div>
  );
}
