'use client';
/**
 * Rider SOS explorer. ACTIVE alerts render in an urgent red band at the top;
 * the rest are a regular history table. Row click opens a drawer where the
 * super-admin can resolve (or cancel) an active alert with a note. Resolving
 * is irreversible, so the action is behind an inline confirm.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { fmtDate, relTime } from '@/lib/utils';
import { AlertOctagon, Phone, Bike, MapPin, CheckCircle2, Ban, Loader2, Siren } from 'lucide-react';

type SosStatus = 'ACTIVE' | 'RESOLVED' | 'CANCELLED';

interface SosRow {
  id: string;
  riderId: string;
  assignmentId: string | null;
  lat: number | null;
  lng: number | null;
  status: SosStatus;
  note: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
  resolvedNote: string | null;
  rider: { id: string; name: string | null; phone: string | null };
}

const FILTERS = ['ALL', 'ACTIVE', 'RESOLVED', 'CANCELLED'] as const;
type Filter = (typeof FILTERS)[number];

export function RiderSosClient({ initial }: { initial: SosRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<SosRow[]>(initial);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = rows.filter((r) => r.status === 'ACTIVE');
  const history = useMemo(() => {
    let r = rows.filter((x) => x.status !== 'ACTIVE');
    if (filter !== 'ALL') r = r.filter((x) => x.status === filter);
    return r;
  }, [rows, filter]);

  const selected = rows.find((r) => r.id === activeId) ?? null;

  function applyUpdate(updated: SosRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <>
      {/* Urgent active band */}
      {active.length > 0 && (
        <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive font-semibold">
            <Siren className="size-5 animate-pulse" />
            {active.length} active SOS alert{active.length === 1 ? '' : 's'} — needs immediate attention
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveId(r.id)}
                className="text-left rounded-lg border border-destructive/40 bg-card p-3 hover:bg-destructive/5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <AlertOctagon className="size-4 text-destructive" />
                    {r.rider.name ?? r.rider.phone ?? 'Unknown rider'}
                  </div>
                  <Badge variant="destructive" className="text-[10px]">
                    ACTIVE
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                  {r.rider.phone && (
                    <span className="font-mono flex items-center gap-1">
                      <Phone className="size-3" />
                      {r.rider.phone}
                    </span>
                  )}
                  <span>Triggered {relTime(r.triggeredAt)}</span>
                  {r.lat != null && r.lng != null && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" />
                      {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                    </span>
                  )}
                </div>
                {r.note && <div className="mt-1.5 text-xs line-clamp-2">{r.note}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {FILTERS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f === 'ALL' ? 'All' : prettyStatus(f as SosStatus)}
              </Chip>
            ))}
            <span className="text-xs text-muted-foreground ml-2">
              {history.length} row{history.length === 1 ? '' : 's'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Siren} title="No SOS alerts" description="No alerts match the current filter." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Rider</Th>
                    <Th>Status</Th>
                    <Th>Location</Th>
                    <Th>Triggered</Th>
                    <Th>Resolved</Th>
                    <th className="text-right px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(r.id)}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs">{r.rider.name ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{r.rider.phone ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {r.lat != null && r.lng != null ? (
                          <a
                            href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            <MapPin className="size-3" />
                            {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.triggeredAt)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.resolvedAt ? fmtDate(r.resolvedAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveId(r.id);
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <SosDrawer
          row={selected}
          onClose={() => setActiveId(null)}
          onUpdated={(u) => {
            applyUpdate(u);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function SosDrawer({
  row,
  onClose,
  onUpdated,
}: {
  row: SosRow;
  onClose: () => void;
  onUpdated: (r: SosRow) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'RESOLVED' | 'CANCELLED' | null>(null);
  const [confirm, setConfirm] = useState<'RESOLVED' | 'CANCELLED' | null>(null);

  async function run(status: 'RESOLVED' | 'CANCELLED') {
    setBusy(status);
    const r = await fetch(`/api/platform/rider-sos/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, resolvedNote: note || undefined }),
    });
    setBusy(null);
    setConfirm(null);
    if (!r.ok) return toast.error(`Action failed: ${await r.text()}`);
    const { alert } = await r.json();
    toast.success(status === 'RESOLVED' ? 'Alert resolved' : 'Alert cancelled');
    onUpdated(alert);
    onClose();
  }

  const isActive = row.status === 'ACTIVE';

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={row.rider.name ?? row.rider.phone ?? 'SOS alert'}
      subtitle={`Triggered ${fmtDate(row.triggeredAt)}`}
      badge={<StatusPill status={row.status} />}
      width="560px"
      footer={
        isActive ? (
          confirm ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground mr-auto">
                {confirm === 'RESOLVED' ? 'Mark this alert resolved?' : 'Cancel this alert?'} This cannot be undone.
              </span>
              <Button size="sm" variant="outline" onClick={() => setConfirm(null)} disabled={busy !== null}>
                Back
              </Button>
              <Button
                size="sm"
                variant={confirm === 'RESOLVED' ? 'success' : 'destructive'}
                onClick={() => run(confirm)}
                disabled={busy !== null}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Confirm
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="success" onClick={() => setConfirm('RESOLVED')}>
                <CheckCircle2 className="size-3.5" /> Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setConfirm('CANCELLED')}
              >
                <Ban className="size-3.5" /> Cancel alert
              </Button>
            </div>
          )
        ) : (
          <div className="text-xs text-muted-foreground text-right">This alert is already closed.</div>
        )
      }
    >
      <DrawerSection title="Rider">
        <div className="p-4 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-medium">
            <Bike className="size-4 text-success" />
            {row.rider.name ?? '—'}
          </div>
          {row.rider.phone && (
            <a
              href={`tel:${row.rider.phone}`}
              className="flex items-center gap-2 text-xs text-primary hover:underline"
            >
              <Phone className="size-3.5" /> <span className="font-mono">{row.rider.phone}</span>
            </a>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="Alert details">
        <div className="p-4 text-sm space-y-2">
          <Row label="Status" value={<StatusPill status={row.status} />} />
          <Row label="Triggered" value={fmtDate(row.triggeredAt)} />
          {row.assignmentId && <Row label="Assignment" value={<span className="font-mono text-xs">{row.assignmentId}</span>} />}
          {row.lat != null && row.lng != null ? (
            <Row
              label="Location"
              value={
                <a
                  href={`https://www.google.com/maps?q=${row.lat},${row.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  <MapPin className="size-3.5" />
                  {row.lat.toFixed(5)}, {row.lng.toFixed(5)}
                </a>
              }
            />
          ) : (
            <Row label="Location" value={<span className="text-muted-foreground">Not shared</span>} />
          )}
          {row.note && (
            <div className="pt-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Rider note</div>
              <p className="mt-1 rounded-md bg-muted/40 p-2 text-xs">{row.note}</p>
            </div>
          )}
        </div>
      </DrawerSection>

      {row.status !== 'ACTIVE' && (
        <DrawerSection title="Resolution">
          <div className="p-4 text-sm space-y-2">
            <Row label="Closed at" value={row.resolvedAt ? fmtDate(row.resolvedAt) : '—'} />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Resolution note</div>
              <p className="mt-1 rounded-md bg-muted/40 p-2 text-xs">{row.resolvedNote || '—'}</p>
            </div>
          </div>
        </DrawerSection>
      )}

      {isActive && (
        <DrawerSection title="Add resolution note">
          <div className="p-4">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Note (recorded in the audit log)
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened? How was it handled?"
              className="mt-1"
            />
          </div>
        </DrawerSection>
      )}
    </DetailDrawer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: SosStatus }) {
  const map: Record<SosStatus, { variant: 'destructive' | 'success' | 'muted'; label: string }> = {
    ACTIVE: { variant: 'destructive', label: 'Active' },
    RESOLVED: { variant: 'success', label: 'Resolved' },
    CANCELLED: { variant: 'muted', label: 'Cancelled' },
  };
  const x = map[status];
  return (
    <Badge variant={x.variant} className="text-[10px]">
      {x.label}
    </Badge>
  );
}

function prettyStatus(s: SosStatus): string {
  return { ACTIVE: 'Active', RESOLVED: 'Resolved', CANCELLED: 'Cancelled' }[s];
}
