'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LogoMark } from '@/components/brand/logo';
import { reportApiError } from '@/lib/api-error';
import { toast } from 'sonner';
import { MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { ZoneForm, type ZoneRow } from './zone-form';

export interface BranchLite { id: string; name: string; lat: number | null; lng: number | null }

const TYPE_LABEL = { POLYGON: 'Polygon', CIRCLE: 'Circle', PINCODE: 'Pincodes' } as const;

export function ZonesClient({ restaurantId, branches }: { restaurantId: string; branches: BranchLite[] }) {
  const [branchId, setBranchId] = useState(branches[0]!.id);
  const [zones, setZones] = useState<ZoneRow[] | null>(null);
  const [editing, setEditing] = useState<ZoneRow | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const branch = branches.find((b) => b.id === branchId) ?? branches[0]!;

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/admin/delivery-zones?restaurantId=${encodeURIComponent(restaurantId)}&branchId=${encodeURIComponent(branchId)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) { await reportApiError(res, 'Could not load zones'); setZones([]); return; }
    const data = (await res.json()) as { zones: ZoneRow[] };
    setZones(data.zones);
  }, [restaurantId, branchId]);

  useEffect(() => { setZones(null); void load(); }, [load]);

  async function remove(z: ZoneRow) {
    if (!confirm(`Delete zone "${z.name}"?`)) return;
    setBusyId(z.id);
    try {
      const res = await fetch(`/api/admin/delivery-zones/${z.id}?restaurantId=${encodeURIComponent(restaurantId)}`, { method: 'DELETE' });
      if (!res.ok) { await reportApiError(res, 'Delete failed'); return; }
      toast.success('Zone deleted');
      await load();
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-5xl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <LogoMark className="size-11 shrink-0 sm:size-12" />
          <div className="min-w-0">
            <h1 className="display text-gradient-brand text-2xl font-semibold sm:text-3xl">Delivery zones</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Draw where each branch delivers and set fees, minimum order and ETA per zone.
            </p>
          </div>
        </div>
        <Button className="h-11" onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="size-4" /> Add zone
        </Button>
      </header>

      {branches.length > 1 && (
        <div className="max-w-sm space-y-1.5">
          <label htmlFor="zone-branch" className="text-xs font-medium text-muted-foreground">Branch</label>
          <select
            id="zone-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}

      {zones === null ? (
        <p className="text-sm text-muted-foreground">Loading zones…</p>
      ) : zones.length === 0 ? (
        <Card><CardContent className="p-0">
          <EmptyState
            icon={MapPinned}
            title="No delivery zones yet"
            description="Add a polygon, circle or pincode zone to start accepting delivery orders for this branch."
          />
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{z.name}</td>
                  <td className="px-4 py-2">{TYPE_LABEL[z.type]}</td>
                  <td className="px-4 py-2">{z.priority}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={z.isActive ? 'default' : 'muted'}>{z.isActive ? 'Active' : 'Inactive'}</Badge>
                      {z.isDefault && <Badge variant="muted">Default</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-11" title="Edit" aria-label={`Edit ${z.name}`}
                        onClick={() => { setEditing(z); setOpen(true); }}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-11" title="Delete" aria-label={`Delete ${z.name}`}
                        disabled={busyId === z.id} onClick={() => remove(z)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-3xl">
          <DialogHeader><DialogTitle>{editing ? 'Edit zone' : 'Add zone'}</DialogTitle></DialogHeader>
          {open && (
            <ZoneForm
              key={editing?.id ?? 'new'}
              restaurantId={restaurantId}
              branchId={branchId}
              branchPoint={branch.lat != null && branch.lng != null ? { lat: branch.lat, lng: branch.lng } : null}
              editing={editing}
              onDone={() => { setOpen(false); void load(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
