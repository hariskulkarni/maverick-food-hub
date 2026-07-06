'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Check, X, Loader2, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface Row {
  id: string;
  action: string;
  capability: string;
  status: string;
  summary: string;
  resourceType: string | null;
  resourceId: string | null;
  requestedBy: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  executionError: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS_STYLE: Record<string, { cls: string; icon: any; label: string }> = {
  PENDING: { cls: 'bg-warning/10 text-warning border-warning/30', icon: Clock, label: 'Pending' },
  APPROVED: { cls: 'bg-success/10 text-success border-success/30', icon: CheckCircle2, label: 'Approved' },
  REJECTED: { cls: 'bg-destructive/10 text-destructive border-destructive/30', icon: XCircle, label: 'Rejected' },
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function ApprovalsClient({ initial, reviewer }: { initial: Row[]; reviewer: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: 'approve' | 'reject') {
    let note: string | undefined;
    if (decision === 'reject') {
      const r = window.prompt('Reason for rejection? (optional)');
      if (r === null) return; // cancelled
      note = r || undefined;
    }
    setBusy(id);
    try {
      const res = await fetch(`/api/platform/approvals/${id}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: decision === 'reject' ? JSON.stringify({ note }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        toast.error(data.detail || data.error || 'Action failed.');
        return;
      }
      toast.success(decision === 'approve' ? 'Approved & executed.' : 'Request rejected.');
      router.refresh();
    } catch {
      toast.error('Network error.');
    } finally {
      setBusy(null);
    }
  }

  const pending = initial.filter((r) => r.status === 'PENDING');
  const decided = initial.filter((r) => r.status !== 'PENDING');

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Pending</h2>
          {pending.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.summary}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Requested by {r.requestedBy} · {when(r.createdAt)} · <span className="font-mono">{r.action}</span>
                  </div>
                  {r.executionError && (
                    <div className="text-xs text-destructive mt-1 flex items-center gap-1">
                      <AlertTriangle className="size-3" /> Last attempt failed: {r.executionError}
                    </div>
                  )}
                </div>
                {reviewer ? (
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" disabled={busy === r.id} onClick={() => decide(r.id, 'approve')}>
                      {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-4 mr-1" /> Approve</>}
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={busy === r.id} onClick={() => decide(r.id, 'reject')}>
                      <X className="size-4 mr-1" /> Reject
                    </Button>
                  </div>
                ) : (
                  <StatusBadge status="PENDING" />
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {decided.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">History</h2>
          {decided.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.summary}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Requested by {r.requestedBy} · {when(r.createdAt)}
                    {r.reviewedBy && <> · {r.status === 'APPROVED' ? 'approved' : 'rejected'} by {r.reviewedBy}{r.reviewedAt ? ` · ${when(r.reviewedAt)}` : ''}</>}
                  </div>
                  {r.reviewNote && <div className="text-xs text-muted-foreground mt-1 italic">“{r.reviewNote}”</div>}
                </div>
                <StatusBadge status={r.status} />
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0 ${s.cls}`}>
      <Icon className="size-3" /> {s.label}
    </span>
  );
}
