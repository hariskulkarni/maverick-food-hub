'use client';
/**
 * Surge zones CRUD. Card grid; one dialog for create + edit. Active toggle is
 * inline; delete confirms first.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { MapPin, Plus, Pencil, Trash2, Loader2, Flame } from 'lucide-react';

interface ZoneRow {
  id: string;
  name: string;
  label: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  multiplier: number;
  isActive: boolean;
  activeFrom: string | null;
  activeTo: string | null;
  createdAt: string;
}

export function SurgeZonesClient({ initial }: { initial: ZoneRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ZoneRow | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ZoneRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleActive(row: ZoneRow) {
    setTogglingId(row.id);
    try {
      const r = await fetch(`/api/platform/surge-zones/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !row.isActive })
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success(row.isActive ? 'Zone deactivated' : 'Zone activated');
      router.refresh();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  async function doDelete(row: ZoneRow) {
    try {
      const r = await fetch(`/api/platform/surge-zones/${row.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Zone deleted');
      setConfirmDelete(null);
      router.refresh();
    } catch (e) {
      toast.error('Failed to delete: ' + (e as Error).message);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}><Plus className="size-4" /> New surge zone</Button>
      </div>

      {initial.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No surge zones yet"
          description="Create a geofenced zone with a pay multiplier to nudge riders toward busy areas."
          action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> New surge zone</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {initial.map((z) => (
            <Card key={z.id} className={z.isActive ? '' : 'opacity-70'}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate flex items-center gap-2">
                      {z.isActive && <Flame className="size-4 text-warning shrink-0" />}
                      {z.name}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{z.label}</p>
                  </div>
                  <Badge variant="success" className="text-[10px] shrink-0">{z.multiplier.toFixed(2)}×</Badge>
                </div>
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <span className="rounded-md border bg-card px-2 py-1 font-mono">
                    {z.centerLat.toFixed(4)}, {z.centerLng.toFixed(4)}
                  </span>
                  <span className="rounded-md border bg-card px-2 py-1">
                    <span className="text-muted-foreground">Radius</span> <strong>{z.radiusKm} km</strong>
                  </span>
                </div>
                {(z.activeFrom || z.activeTo) && (
                  <div className="text-[11px] text-muted-foreground">
                    {z.activeFrom ? new Date(z.activeFrom).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    {' — '}
                    {z.activeTo ? new Date(z.activeTo).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '∞'}
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-3">
                  <label className="flex items-center gap-2 text-xs">
                    {togglingId === z.id
                      ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      : <Switch checked={z.isActive} onCheckedChange={() => toggleActive(z)} />}
                    <span className="text-muted-foreground">{z.isActive ? 'Active' : 'Inactive'}</span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(z)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button
                      size="sm" variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(z)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <ZoneDialog
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      {confirmDelete && (
        <Dialog open onOpenChange={(v) => !v && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete surge zone</DialogTitle>
              <DialogDescription>
                Delete &ldquo;{confirmDelete.name}&rdquo;? Riders will stop seeing this zone immediately. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => doDelete(confirmDelete)}>Delete zone</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function ZoneDialog({ row, onClose, onSaved }: {
  row: ZoneRow | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: row?.name ?? '',
    label: row?.label ?? 'Busy area',
    centerLat: row ? String(row.centerLat) : '',
    centerLng: row ? String(row.centerLng) : '',
    radiusKm: row ? String(row.radiusKm) : '2',
    multiplier: row ? String(row.multiplier) : '1.5',
    isActive: row?.isActive ?? true,
    activeFrom: row ? toLocalInput(row.activeFrom) : '',
    activeTo: row ? toLocalInput(row.activeTo) : ''
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (form.name.trim().length < 2) return toast.error('Name is required (≥ 2 chars).');
    const lat = Number(form.centerLat);
    const lng = Number(form.centerLng);
    const radius = Number(form.radiusKm);
    const mult = Number(form.multiplier);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) return toast.error('Latitude must be between -90 and 90.');
    if (Number.isNaN(lng) || lng < -180 || lng > 180) return toast.error('Longitude must be between -180 and 180.');
    if (Number.isNaN(radius) || radius < 0.1 || radius > 50) return toast.error('Radius must be between 0.1 and 50 km.');
    if (Number.isNaN(mult) || mult < 1 || mult > 5) return toast.error('Multiplier must be between 1 and 5.');

    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        label: form.label.trim() || 'Busy area',
        centerLat: lat,
        centerLng: lng,
        radiusKm: radius,
        multiplier: mult,
        isActive: form.isActive,
        activeFrom: form.activeFrom ? new Date(form.activeFrom).toISOString() : null,
        activeTo: form.activeTo ? new Date(form.activeTo).toISOString() : null
      };
      const r = await fetch(
        row ? `/api/platform/surge-zones/${row.id}` : '/api/platform/surge-zones',
        {
          method: row ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (!r.ok) throw new Error(await r.text());
      toast.success(row ? 'Zone updated' : 'Zone created');
      onSaved();
    } catch (e) {
      toast.error('Failed to save: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{row ? 'Edit surge zone' : 'New surge zone'}</DialogTitle>
          <DialogDescription>A circular geofence with a pay multiplier active for an optional window.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Koramangala core" />
            </div>
            <div>
              <Label>Label</Label>
              <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Busy area" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Center latitude</Label>
              <Input type="number" step="any" value={form.centerLat} onChange={(e) => set('centerLat', e.target.value)} placeholder="12.9352" />
            </div>
            <div>
              <Label>Center longitude</Label>
              <Input type="number" step="any" value={form.centerLng} onChange={(e) => set('centerLng', e.target.value)} placeholder="77.6245" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Radius (km)</Label>
              <Input type="number" step="0.1" min={0.1} max={50} value={form.radiusKm} onChange={(e) => set('radiusKm', e.target.value)} />
            </div>
            <div>
              <Label>Multiplier (1–5×)</Label>
              <Input type="number" step="0.1" min={1} max={5} value={form.multiplier} onChange={(e) => set('multiplier', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Active from <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="datetime-local" value={form.activeFrom} onChange={(e) => set('activeFrom', e.target.value)} />
            </div>
            <div>
              <Label>Active to <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="datetime-local" value={form.activeTo} onChange={(e) => set('activeTo', e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.isActive} onCheckedChange={(v) => set('isActive', v)} />
            <span className="text-muted-foreground">Active</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} {row ? 'Save changes' : 'Create zone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
