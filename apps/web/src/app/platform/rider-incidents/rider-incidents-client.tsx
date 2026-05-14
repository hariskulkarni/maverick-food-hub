'use client';
/**
 * Rider incident reports explorer. Filter by status + type; row click opens a
 * drawer to inspect the report (description, location, photo) and update its
 * status + resolution note.
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
import { fmtDate } from '@/lib/utils';
import { ShieldAlert, Phone, Bike, MapPin, Loader2, Save } from 'lucide-react';

type IncidentStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
type IncidentType =
  | 'ACCIDENT'
  | 'HARASSMENT'
  | 'VEHICLE_BREAKDOWN'
  | 'THEFT'
  | 'UNSAFE_LOCATION'
  | 'CUSTOMER_DISPUTE'
  | 'OTHER';

interface IncidentRow {
  id: string;
  riderId: string;
  assignmentId: string | null;
  type: IncidentType;
  status: IncidentStatus;
  description: string;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  rider: { id: string; name: string | null; phone: string | null };
}

const STATUSES: (IncidentStatus | 'ALL')[] = ['ALL', 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'];
const TYPES: (IncidentType | 'ALL')[] = [
  'ALL',
  'ACCIDENT',
  'HARASSMENT',
  'VEHICLE_BREAKDOWN',
  'THEFT',
  'UNSAFE_LOCATION',
  'CUSTOMER_DISPUTE',
  'OTHER',
];

export function RiderIncidentsClient({ initial }: { initial: IncidentRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<IncidentRow[]>(initial);
  const [status, setStatus] = useState<IncidentStatus | 'ALL'>('ALL');
  const [type, setType] = useState<IncidentType | 'ALL'>('ALL');
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let r = rows.slice();
    if (status !== 'ALL') r = r.filter((x) => x.status === status);
    if (type !== 'ALL') r = r.filter((x) => x.type === type);
    return r;
  }, [rows, status, type]);

  const selected = rows.find((r) => r.id === activeId) ?? null;

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s === 'ALL' ? 'All' : prettyStatus(s as IncidentStatus)}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Type:</span>
            {TYPES.map((t) => (
              <Chip key={t} active={type === t} onClick={() => setType(t)}>
                {t === 'ALL' ? 'All' : prettyType(t as IncidentType)}
              </Chip>
            ))}
            <span className="text-xs text-muted-foreground ml-2">
              {filtered.length} report{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={ShieldAlert}
                title="No incident reports"
                description="No reports match the current filters."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Rider</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Description</Th>
                    <Th>Reported</Th>
                    <th className="text-right px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(r.id)}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs">{r.rider.name ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{r.rider.phone ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-[10px]">
                          {prettyType(r.type)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[280px] truncate">
                        {r.description}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.createdAt)}</td>
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
        <IncidentDrawer
          row={selected}
          onClose={() => setActiveId(null)}
          onUpdated={(u) => {
            setRows((prev) => prev.map((r) => (r.id === u.id ? u : r)));
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function IncidentDrawer({
  row,
  onClose,
  onUpdated,
}: {
  row: IncidentRow;
  onClose: () => void;
  onUpdated: (r: IncidentRow) => void;
}) {
  const [status, setStatus] = useState<IncidentStatus>(row.status);
  const [resolution, setResolution] = useState(row.resolution ?? '');
  const [busy, setBusy] = useState(false);

  const dirty = status !== row.status || resolution !== (row.resolution ?? '');

  async function save() {
    setBusy(true);
    const r = await fetch(`/api/platform/rider-incidents/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, resolution: resolution || null }),
    });
    setBusy(false);
    if (!r.ok) return toast.error(`Update failed: ${await r.text()}`);
    const { incident } = await r.json();
    toast.success('Incident updated');
    onUpdated(incident);
    onClose();
  }

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={prettyType(row.type)}
      subtitle={`Reported ${fmtDate(row.createdAt)}`}
      badge={<StatusPill status={row.status} />}
      width="580px"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save changes
          </Button>
        </div>
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

      <DrawerSection title="Report">
        <div className="p-4 text-sm space-y-2">
          <Row label="Type" value={<Badge variant="secondary" className="text-[10px]">{prettyType(row.type)}</Badge>} />
          {row.assignmentId && (
            <Row label="Assignment" value={<span className="font-mono text-xs">{row.assignmentId}</span>} />
          )}
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
          <div className="pt-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Description</div>
            <p className="mt-1 rounded-md bg-muted/40 p-2 text-xs whitespace-pre-wrap">{row.description}</p>
          </div>
          {row.photoUrl && (
            <div className="pt-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Photo</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.photoUrl}
                alt="Incident photo"
                className="rounded-md border max-h-60 object-cover w-full"
              />
            </div>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="Update">
        <div className="p-4 space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as IncidentStatus)}
              className="h-9 mt-1 w-full rounded-md border bg-card px-2 text-sm"
            >
              {(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'] as IncidentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {prettyStatus(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Resolution note</Label>
            <Textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="How was this incident handled?"
              className="mt-1"
            />
          </div>
        </div>
      </DrawerSection>
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

function StatusPill({ status }: { status: IncidentStatus }) {
  const map: Record<IncidentStatus, { variant: 'warning' | 'default' | 'success' | 'muted'; label: string }> = {
    OPEN: { variant: 'warning', label: 'Open' },
    UNDER_REVIEW: { variant: 'default', label: 'Under review' },
    RESOLVED: { variant: 'success', label: 'Resolved' },
    CLOSED: { variant: 'muted', label: 'Closed' },
  };
  const x = map[status];
  return (
    <Badge variant={x.variant} className="text-[10px]">
      {x.label}
    </Badge>
  );
}

function prettyStatus(s: IncidentStatus): string {
  return { OPEN: 'Open', UNDER_REVIEW: 'Under review', RESOLVED: 'Resolved', CLOSED: 'Closed' }[s];
}

function prettyType(t: IncidentType): string {
  return {
    ACCIDENT: 'Accident',
    HARASSMENT: 'Harassment',
    VEHICLE_BREAKDOWN: 'Vehicle breakdown',
    THEFT: 'Theft',
    UNSAFE_LOCATION: 'Unsafe location',
    CUSTOMER_DISPUTE: 'Customer dispute',
    OTHER: 'Other',
  }[t];
}
