'use client';
/**
 * Support tickets client.
 * Filter bar (status / priority / type / search) drives an in-place filter
 * over rows from the server. Row click opens DetailDrawer with message,
 * related order link, and status/priority/assignment/resolution controls.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { toast } from 'sonner';
import { Inbox, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

type Ticket = {
  id: string;
  orderId: string | null;
  customerId: string | null;
  restaurantId: string | null;
  riderId: string | null;
  type: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  message: string;
  assignedTo: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Stats = { OPEN: number; IN_PROGRESS: number; RESOLVED: number; CLOSED: number };

const STATUSES = ['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const PRIORITIES = ['ALL', 'LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const TYPES = ['ALL', 'ORDER_DELAY', 'WRONG_ITEM', 'MISSING_ITEM', 'PAYMENT_ISSUE', 'REFUND_REQUEST', 'RIDER_ISSUE', 'FOOD_QUALITY', 'DELIVERY_NOT_RECEIVED', 'OTHER'] as const;

type StatusFilter = typeof STATUSES[number];
type PriorityFilter = typeof PRIORITIES[number];
type TypeFilter = typeof TYPES[number];

export function SupportClient({ initial, stats }: { initial: Ticket[]; stats: Stats }) {
  const router = useRouter();
  const [tickets, setTickets] = React.useState<Ticket[]>(initial);
  const [status, setStatus] = React.useState<StatusFilter>('ALL');
  const [priority, setPriority] = React.useState<PriorityFilter>('ALL');
  const [type, setType] = React.useState<TypeFilter>('ALL');
  const [search, setSearch] = React.useState('');
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const rows = React.useMemo(() => {
    let r = tickets.slice();
    if (status !== 'ALL') r = r.filter((t) => t.status === status);
    if (priority !== 'ALL') r = r.filter((t) => t.priority === priority);
    if (type !== 'ALL') r = r.filter((t) => t.type === type);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((t) =>
        t.message.toLowerCase().includes(q) ||
        (t.resolution ?? '').toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.orderId ?? '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [tickets, status, priority, type, search]);

  const active = tickets.find((t) => t.id === activeId) ?? null;

  async function update(id: string, patch: Partial<Pick<Ticket, 'status' | 'priority' | 'assignedTo' | 'resolution'>>) {
    const r = await fetch(`/api/platform/support/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (!r.ok) return toast.error('Failed: ' + (await r.text()));
    const { ticket } = await r.json();
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...ticket } : t)));
    toast.success('Updated');
    router.refresh();
  }

  return (
    <>
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Inbox} label="Open" value={stats.OPEN} tone="warning" />
        <Stat icon={Loader2} label="In progress" value={stats.IN_PROGRESS} tone="primary" />
        <Stat icon={CheckCircle2} label="Resolved" value={stats.RESOLVED} tone="success" />
        <Stat icon={XCircle} label="Closed" value={stats.CLOSED} tone="muted" />
      </div>

      {/* Filter bar */}
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Search</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Message, ticket id, order id…" />
          </div>
        </div>

        <ChipRow label="Status" options={STATUSES as any} value={status} onChange={(v) => setStatus(v as StatusFilter)} />
        <ChipRow label="Priority" options={PRIORITIES as any} value={priority} onChange={(v) => setPriority(v as PriorityFilter)} />
        <ChipRow label="Type" options={TYPES as any} value={type} onChange={(v) => setType(v as TypeFilter)} />
      </CardContent></Card>

      {/* Table */}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Created</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Priority</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Order</th>
              <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No tickets match.</td></tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setActiveId(t.id)}>
                <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="px-4 py-3 text-xs"><Badge variant="muted">{t.type}</Badge></td>
                <td className="px-4 py-3"><PriorityBadge p={t.priority} /></td>
                <td className="px-4 py-3"><StatusBadge s={t.status} /></td>
                <td className="px-4 py-3 font-mono text-[11px]">{t.orderId ? t.orderId.slice(0, 8) : '—'}</td>
                <td className="px-4 py-3 text-xs max-w-md"><div className="line-clamp-1">{t.message}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      {/* Detail drawer */}
      <DetailDrawer
        open={!!active}
        onOpenChange={(v) => !v && setActiveId(null)}
        title={active ? `Ticket · ${active.type}` : 'Ticket'}
        subtitle={active ? `Opened ${new Date(active.createdAt).toLocaleString('en-IN')}` : undefined}
        badge={active ? <StatusBadge s={active.status} /> : undefined}
      >
        {active && (
          <>
            <DrawerSection title="Message">
              <div className="p-4 text-sm whitespace-pre-wrap">{active.message}</div>
            </DrawerSection>

            {active.orderId && (
              <DrawerSection title="Related order">
                <div className="p-4 text-sm">
                  <Link href={`/platform/orders?id=${active.orderId}`} className="text-primary underline font-mono text-xs">
                    {active.orderId}
                  </Link>
                </div>
              </DrawerSection>
            )}

            <DrawerSection title="Actions">
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={active.status === 'IN_PROGRESS'} onClick={() => update(active.id, { status: 'IN_PROGRESS' })}>
                    <Loader2 className="size-4" /> Start
                  </Button>
                  <Button size="sm" variant="outline" disabled={active.status === 'RESOLVED'} onClick={() => update(active.id, { status: 'RESOLVED' })}>
                    <CheckCircle2 className="size-4" /> Resolve
                  </Button>
                  <Button size="sm" variant="outline" disabled={active.status === 'CLOSED'} onClick={() => update(active.id, { status: 'CLOSED' })}>
                    <XCircle className="size-4" /> Close
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={active.priority === p ? 'default' : 'outline'}
                      onClick={() => update(active.id, { priority: p })}
                    >
                      <AlertTriangle className="size-4" /> {p}
                    </Button>
                  ))}
                </div>

                <ResolutionForm
                  initial={active.resolution ?? ''}
                  onSave={(resolution) => update(active.id, { resolution })}
                />
              </div>
            </DrawerSection>
          </>
        )}
      </DetailDrawer>
    </>
  );
}

function ResolutionForm({ initial, onSave }: { initial: string; onSave: (r: string) => void }) {
  const [val, setVal] = React.useState(initial);
  return (
    <div className="space-y-2">
      <Label className="text-xs">Resolution notes</Label>
      <Textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3} placeholder="What was done?" />
      <Button size="sm" onClick={() => onSave(val)}>Save resolution</Button>
    </div>
  );
}

function ChipRow({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`rounded-full px-2.5 py-0.5 text-xs border transition-colors ${value === o ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent border-border text-foreground'}`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: 'success' | 'primary' | 'warning' | 'muted' }) {
  const cls = {
    success: 'bg-success/10 text-success border-success/30',
    primary: 'bg-primary/10 text-primary border-primary/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
    muted: 'bg-muted text-muted-foreground border-border'
  }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${cls}`}>
      <Icon className="size-5" />
      <div>
        <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
        <div className="font-bold text-xl leading-none">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: Ticket['status'] }) {
  const v = s === 'OPEN' ? 'warning' : s === 'IN_PROGRESS' ? 'default' : s === 'RESOLVED' ? 'success' : 'muted';
  return <Badge variant={v as any}>{s}</Badge>;
}

function PriorityBadge({ p }: { p: Ticket['priority'] }) {
  const v = p === 'URGENT' ? 'destructive' : p === 'HIGH' ? 'warning' : p === 'NORMAL' ? 'default' : 'muted';
  return <Badge variant={v as any}>{p}</Badge>;
}
