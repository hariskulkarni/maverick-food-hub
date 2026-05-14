'use client';
/**
 * COD collections explorer.
 *
 * Filter bar (rider, status chips, date range, CSV export) drives an in-place
 * filter+sort over the rows returned by the server component. Row click opens
 * a DetailDrawer with amounts, rider/order info, notes textarea, and four
 * action buttons that POST to /api/platform/cod/:id/<action>.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { toast } from 'sonner';
import { money } from '@/lib/utils';
import { Download, ArrowUpDown, Phone, Bike, CheckCircle2, AlertTriangle, PiggyBank, Ban, Loader2 } from 'lucide-react';

type CodStatus = 'PENDING_COLLECTION' | 'COLLECTED' | 'PARTIAL_COLLECTED' | 'MISMATCH' | 'DEPOSIT_PENDING' | 'RECONCILED' | 'WAIVED';

interface CodRow {
  id: string;
  orderId: string;
  riderId: string;
  amountToCollect: any;
  amountCollected: any | null;
  status: CodStatus;
  collectedAt: string | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  notes: string | null;
  createdAt: string;
  order: { code: string; total: any };
  rider: { id: string; user: { name: string | null; phone: string | null } };
}

interface RiderOpt {
  id: string;
  name: string | null;
  phone: string | null;
}

const STATUS_FILTERS = ['ALL', 'PENDING_COLLECTION', 'COLLECTED', 'DEPOSIT_PENDING', 'RECONCILED', 'MISMATCH'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

type SortKey = 'code' | 'rider' | 'due' | 'collected' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

export function CodClient({ initial, riders }: { initial: CodRow[]; riders: RiderOpt[] }) {
  const router = useRouter();
  const [riderId, setRiderId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeId, setActiveId] = useState<string | null>(null);

  const rows = useMemo(() => {
    let r = initial.slice();
    if (riderId) r = r.filter((x) => x.riderId === riderId);
    if (status !== 'ALL') r = r.filter((x) => x.status === status);
    if (from) { const t = new Date(from).getTime(); r = r.filter((x) => new Date(x.createdAt).getTime() >= t); }
    if (to)   { const t = new Date(to).getTime() + 86_400_000 - 1; r = r.filter((x) => new Date(x.createdAt).getTime() <= t); }

    r.sort((a, b) => {
      let av: number | string; let bv: number | string;
      switch (sortKey) {
        case 'code':      av = a.order.code; bv = b.order.code; break;
        case 'rider':     av = a.rider.user.name ?? a.rider.user.phone ?? ''; bv = b.rider.user.name ?? b.rider.user.phone ?? ''; break;
        case 'due':       av = Number(a.amountToCollect); bv = Number(b.amountToCollect); break;
        case 'collected': av = Number(a.amountCollected ?? 0); bv = Number(b.amountCollected ?? 0); break;
        case 'status':    av = a.status; bv = b.status; break;
        case 'createdAt': default: av = new Date(a.createdAt).getTime(); bv = new Date(b.createdAt).getTime();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
    return r;
  }, [initial, riderId, status, from, to, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  }

  function exportCsv() {
    const head = ['Order code', 'Rider', 'Phone', 'Amount due', 'Collected', 'Status', 'Created at', 'Collected at', 'Reconciled at', 'Notes'];
    const lines = [head, ...rows.map((r) => [
      r.order.code,
      r.rider.user.name ?? '',
      r.rider.user.phone ?? '',
      Number(r.amountToCollect),
      r.amountCollected == null ? '' : Number(r.amountCollected),
      r.status,
      r.createdAt,
      r.collectedAt ?? '',
      r.reconciledAt ?? '',
      (r.notes ?? '').replace(/\n/g, ' ')
    ])];
    const csv = lines.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cod-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const active = rows.find((r) => r.id === activeId) ?? initial.find((r) => r.id === activeId) ?? null;

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px]">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Rider</Label>
              <select value={riderId} onChange={(e) => setRiderId(e.target.value)} className="h-9 mt-1 w-full rounded-md border bg-card px-2 text-sm">
                <option value="">All riders</option>
                {riders.map((r) => <option key={r.id} value={r.id}>{r.name ?? r.phone}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 mt-1 w-[160px]" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 mt-1 w-[160px]" />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUS_FILTERS.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{prettyStatus(s)}</Chip>
            ))}
            <span className="text-xs text-muted-foreground ml-3">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <ThSort label="Order code" k="code"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Rider"      k="rider"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Amount due" k="due"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <ThSort label="Collected"  k="collected" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                  <ThSort label="Status"     k="status"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Created"    k="createdAt" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                  <th className="text-right px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">No COD collections match these filters.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(r.id)}>
                    <td className="px-4 py-3 font-mono text-xs">{r.order.code}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs truncate max-w-[160px]">{r.rider.user.name ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{r.rider.user.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(r.amountToCollect)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.amountCollected == null ? '—' : money(r.amountCollected)}</td>
                    <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveId(r.id); }}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {active && (
        <CodDrawer
          row={active}
          onClose={() => setActiveId(null)}
          onDone={() => { setActiveId(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function CodDrawer({ row, onClose, onDone }: { row: CodRow; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState(row.notes ?? '');
  const [amount, setAmount] = useState<string>(row.amountCollected != null ? String(Number(row.amountCollected)) : String(Number(row.amountToCollect)));
  const [busy, setBusy] = useState<string | null>(null);

  async function run(action: 'mark-collected' | 'mark-mismatch' | 'reconcile' | 'waive', label: string) {
    setBusy(action);
    const body: any = { notes: notes || undefined };
    const n = Number(amount);
    if (!Number.isNaN(n) && amount !== '') body.amount = n;

    const r = await fetch(`/api/platform/cod/${row.id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setBusy(null);
    if (!r.ok) return toast.error(`${label} failed: ${await r.text()}`);
    toast.success(`${label} OK`);
    onDone();
  }

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={<span className="font-mono">{row.order.code}</span>}
      subtitle={`Created ${new Date(row.createdAt).toLocaleString('en-IN')}`}
      badge={<StatusPill status={row.status} />}
      width="620px"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="success" disabled={busy !== null} onClick={() => run('mark-collected', 'Mark collected')}>
            {busy === 'mark-collected' ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Mark collected
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('mark-mismatch', 'Flag mismatch')} className="text-warning border-warning/40 hover:bg-warning/10">
            {busy === 'mark-mismatch' ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />} Mark mismatch
          </Button>
          <Button size="sm" variant="default" disabled={busy !== null} onClick={() => run('reconcile', 'Reconcile')}>
            {busy === 'reconcile' ? <Loader2 className="size-3.5 animate-spin" /> : <PiggyBank className="size-3.5" />} Reconcile
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('waive', 'Waive')} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            {busy === 'waive' ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />} Waive
          </Button>
        </div>
      }
    >
      <DrawerSection title="Amounts">
        <div className="p-4 grid grid-cols-2 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Order total</span>
          <span className="text-right tabular-nums">{money(row.order.total)}</span>
          <span className="text-muted-foreground">Amount due</span>
          <span className="text-right tabular-nums font-semibold">{money(row.amountToCollect)}</span>
          <span className="text-muted-foreground">Amount collected</span>
          <span className="text-right tabular-nums">{row.amountCollected == null ? '—' : money(row.amountCollected)}</span>
          {row.collectedAt && (<>
            <span className="text-muted-foreground">Collected at</span>
            <span className="text-right text-xs text-muted-foreground">{new Date(row.collectedAt).toLocaleString('en-IN')}</span>
          </>)}
          {row.reconciledAt && (<>
            <span className="text-muted-foreground">Reconciled at</span>
            <span className="text-right text-xs text-muted-foreground">{new Date(row.reconciledAt).toLocaleString('en-IN')}</span>
          </>)}
        </div>
      </DrawerSection>

      <DrawerSection title="Rider">
        <div className="p-4 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-medium"><Bike className="size-4 text-success" />{row.rider.user.name ?? row.rider.user.phone ?? '—'}</div>
          {row.rider.user.phone && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Phone className="size-3.5" /> <span className="font-mono">{row.rider.user.phone}</span></div>}
        </div>
      </DrawerSection>

      <DrawerSection title="Order">
        <div className="p-4 text-sm space-y-1">
          <div className="font-mono text-xs">{row.order.code}</div>
          <div className="text-xs text-muted-foreground">Order total: {money(row.order.total)}</div>
        </div>
      </DrawerSection>

      <DrawerSection title="Adjust">
        <div className="p-4 space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Amount applied to action</Label>
            <Input type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9 w-40" />
            <p className="text-[11px] text-muted-foreground mt-1">Defaults to amount due; override for partial / mismatch.</p>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why? (audit log will capture this)" className="mt-1" />
          </div>
        </div>
      </DrawerSection>
    </DetailDrawer>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function ThSort({ label, k, sortKey, sortDir, onClick, align = 'left' }: { label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onClick: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const active = sortKey === k;
  return (
    <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>
      <button onClick={() => onClick(k)} className={`inline-flex items-center gap-1 ${active ? 'text-foreground' : ''}`}>
        {label} <ArrowUpDown className={`size-3 ${active ? '' : 'opacity-50'}`} />
        {active && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

function StatusPill({ status }: { status: CodStatus }) {
  const map: Record<CodStatus, { variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'muted'; label: string }> = {
    PENDING_COLLECTION: { variant: 'warning',     label: 'Pending' },
    COLLECTED:          { variant: 'success',     label: 'Collected' },
    PARTIAL_COLLECTED:  { variant: 'warning',     label: 'Partial' },
    MISMATCH:           { variant: 'destructive', label: 'Mismatch' },
    DEPOSIT_PENDING:    { variant: 'default',     label: 'Deposit pending' },
    RECONCILED:         { variant: 'success',     label: 'Reconciled' },
    WAIVED:             { variant: 'muted',       label: 'Waived' }
  };
  const x = map[status];
  return <Badge variant={x.variant} className="text-[10px]">{x.label}</Badge>;
}

function prettyStatus(s: StatusFilter): string {
  return ({
    ALL: 'All',
    PENDING_COLLECTION: 'Pending',
    COLLECTED: 'Collected',
    DEPOSIT_PENDING: 'Deposit pending',
    RECONCILED: 'Reconciled',
    MISMATCH: 'Mismatch'
  } as Record<StatusFilter, string>)[s];
}
