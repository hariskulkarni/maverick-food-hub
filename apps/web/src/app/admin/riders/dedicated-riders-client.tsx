'use client';
/**
 * Dedicated Riders — client side.
 *
 *   • Dispatch mode card — pick FLEET_ONLY / DEDICATED_ONLY / DEDICATED_FIRST
 *     with human descriptions; fleetFallbackMinutes input shows only for
 *     DEDICATED_FIRST. Saves via PATCH /api/admin/dispatch-mode.
 *   • Roster table — name, phone, online status, rating, deliveries, vehicle.
 *     Each row has a confirmed "Remove" (un-dedicate → FLEET).
 *   • Add dedicated rider — phone input → POST /api/admin/dedicated-riders.
 *     Surfaces the API's specific error (not found / not approved / dedicated
 *     elsewhere).
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  Bike,
  Loader2,
  Plus,
  Trash2,
  Star,
  Truck,
  Route,
  Save,
  CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';

type DispatchMode = 'FLEET_ONLY' | 'DEDICATED_ONLY' | 'DEDICATED_FIRST';

interface Rider {
  id: string;
  name: string | null;
  phone: string | null;
  isOnline: boolean;
  rating: number;
  totalDeliveries: number;
  vehicleType: string | null;
  vehicleNumber: string | null;
  approvedAt: string | null;
}

interface Dispatch {
  riderDispatchMode: DispatchMode;
  fleetFallbackMinutes: number;
}

const MODE_OPTIONS: { value: DispatchMode; label: string; description: string }[] = [
  {
    value: 'FLEET_ONLY',
    label: 'Fleet only',
    description:
      'Ready orders go straight to the platform-wide rider pool. Any online rider can claim them. You don’t manage riders.'
  },
  {
    value: 'DEDICATED_ONLY',
    label: 'Dedicated only',
    description:
      'Only riders you’ve dedicated to your restaurant can claim your orders. Orders wait until one of your riders is free.'
  },
  {
    value: 'DEDICATED_FIRST',
    label: 'Dedicated first, then fleet',
    description:
      'Your dedicated riders get first dibs. If none claims the order within the fallback window, it opens to the platform fleet.'
  }
];

export function DedicatedRidersClient({
  initialRiders,
  initialDispatch
}: {
  initialRiders: Rider[];
  initialDispatch: Dispatch;
}) {
  const [riders, setRiders] = useState<Rider[]>(initialRiders);

  return (
    <div className="space-y-6">
      <DispatchModeCard initial={initialDispatch} />
      <RosterCard riders={riders} setRiders={setRiders} />
    </div>
  );
}

/* ─────────────────────────── Dispatch mode ─────────────────────────── */

function DispatchModeCard({ initial }: { initial: Dispatch }) {
  const [mode, setMode] = useState<DispatchMode>(initial.riderDispatchMode);
  const [fallback, setFallback] = useState<number>(initial.fleetFallbackMinutes);
  const [saving, setSaving] = useState(false);

  const dirty =
    mode !== initial.riderDispatchMode ||
    (mode === 'DEDICATED_FIRST' && fallback !== initial.fleetFallbackMinutes);

  async function save() {
    if (mode === 'DEDICATED_FIRST' && (!Number.isFinite(fallback) || fallback < 1 || fallback > 120)) {
      toast.error('Fallback window must be between 1 and 120 minutes.');
      return;
    }
    setSaving(true);
    try {
      const body: any = { riderDispatchMode: mode };
      if (mode === 'DEDICATED_FIRST') body.fleetFallbackMinutes = fallback;
      const r = await fetch('/api/admin/dispatch-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      const j = await r.json();
      // Sync the baseline so the "Save" button settles.
      initial.riderDispatchMode = j.riderDispatchMode;
      initial.fleetFallbackMinutes = j.fleetFallbackMinutes;
      setMode(j.riderDispatchMode);
      setFallback(j.fleetFallbackMinutes);
      toast.success('Dispatch mode saved.');
    } catch (e: any) {
      toast.error('Failed to save dispatch mode', { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Route className="size-5" />
        </div>
        <div>
          <h2 className="display text-xl font-semibold">Dispatch mode</h2>
          <p className="text-xs text-muted-foreground">How your ready orders find a rider.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="grid gap-3">
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`text-left rounded-lg border p-4 transition-colors ${
                    active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`grid size-4 place-items-center rounded-full border ${
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                      }`}
                    >
                      {active && <CheckCircle2 className="size-4" />}
                    </span>
                    <span className="font-medium">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 pl-6">{opt.description}</p>
                </button>
              );
            })}
          </div>

          {mode === 'DEDICATED_FIRST' && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <Label htmlFor="fallback">Fleet fallback window (minutes)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="fallback"
                  type="number"
                  min={1}
                  max={120}
                  value={Number.isFinite(fallback) ? fallback : ''}
                  onChange={(e) => setFallback(parseInt(e.target.value, 10))}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">
                  How long to wait on your dedicated riders before opening the order to the platform fleet.
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save dispatch mode
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ─────────────────────────── Roster ─────────────────────────── */

function RosterCard({
  riders,
  setRiders
}: {
  riders: Rider[];
  setRiders: React.Dispatch<React.SetStateAction<Rider[]>>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Rider | null>(null);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Bike className="size-5" />
          </div>
          <div>
            <h2 className="display text-xl font-semibold">Dedicated riders ({riders.length})</h2>
            <p className="text-xs text-muted-foreground">Riders that work exclusively for your restaurant.</p>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm">
          <Plus className="size-4" />
          Add rider
        </Button>
      </div>

      {riders.length === 0 ? (
        <EmptyState
          icon={Bike}
          title="No dedicated riders yet"
          description="Add an approved platform rider by phone number to dedicate them to your restaurant."
          action={
            <Button onClick={() => setAddOpen(true)} size="sm">
              <Plus className="size-4" />
              Add dedicated rider
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>Rider</Th>
                    <Th>Phone</Th>
                    <Th>Status</Th>
                    <Th>Rating</Th>
                    <Th>Deliveries</Th>
                    <Th>Vehicle</Th>
                    <Th align="right">&nbsp;</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {riders.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{r.name ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.phone ?? '—'}</td>
                      <td className="px-4 py-3">
                        {r.isOnline ? (
                          <Badge variant="success">Online</Badge>
                        ) : (
                          <Badge variant="secondary">Offline</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1">
                          <Star className="size-3.5 fill-warning text-warning" />
                          {r.rating != null ? r.rating.toFixed(1) : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{r.totalDeliveries}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Truck className="size-3.5" />
                          {r.vehicleType ?? '—'}
                          {r.vehicleNumber ? ` · ${r.vehicleNumber}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 className="size-4" />
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AddRiderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(rider) => setRiders((prev) => [rider, ...prev.filter((p) => p.id !== rider.id)])}
      />
      <RemoveRiderDialog
        rider={removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onRemoved={(id) => {
          setRiders((prev) => prev.filter((p) => p.id !== id));
          setRemoving(null);
        }}
      />
    </section>
  );
}

/* ─────────────────────────── Add dialog ─────────────────────────── */

function AddRiderDialog({
  open,
  onOpenChange,
  onAdded
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (r: Rider) => void;
}) {
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhone('');
    setError(null);
    setSubmitting(false);
  }

  async function submit() {
    if (!phone.trim()) {
      setError('Enter a phone number.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/dedicated-riders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error ?? `Could not add rider (HTTP ${r.status}).`);
        return;
      }
      toast.success(`${j.rider?.name ?? 'Rider'} is now dedicated to your restaurant.`);
      onAdded(j.rider);
      onOpenChange(false);
      reset();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add dedicated rider</DialogTitle>
          <DialogDescription>
            Enter the phone number of an approved platform rider. They’ll be moved from the platform fleet to
            your restaurant’s dedicated roster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="rider-phone">Rider phone number</Label>
          <Input
            id="rider-phone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && !submitting && submit()}
            placeholder="+91 98765 43210"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add rider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Remove dialog ─────────────────────────── */

function RemoveRiderDialog({
  rider,
  onOpenChange,
  onRemoved
}: {
  rider: Rider | null;
  onOpenChange: (o: boolean) => void;
  onRemoved: (id: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    if (!rider) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/dedicated-riders/${rider.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
      toast.success(`${rider.name ?? 'Rider'} returned to the platform fleet.`);
      onRemoved(rider.id);
    } catch (e: any) {
      toast.error('Failed to remove rider', { description: e?.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!rider} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove dedicated rider?</DialogTitle>
          <DialogDescription>
            {rider?.name ?? 'This rider'} will no longer be dedicated to your restaurant and will return to the
            platform-wide fleet pool. You can re-add them later by phone number.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Remove rider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── bits ─────────────────────────── */

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}
    >
      {children}
    </th>
  );
}
