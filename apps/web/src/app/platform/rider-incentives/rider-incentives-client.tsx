'use client';
/**
 * Rider incentives CRUD. Card grid of slabs; a single dialog handles both
 * create and edit. Toggling active flips isActive inline; delete confirms first.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Trophy, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { money } from '@/lib/utils';

interface IncentiveRow {
  id: string;
  title: string;
  description: string | null;
  period: 'DAILY' | 'WEEKLY';
  targetDeliveries: number;
  bonusAmount: number;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export function RiderIncentivesClient({ initial }: { initial: IncentiveRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<IncentiveRow | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<IncentiveRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function toggleActive(row: IncentiveRow) {
    setTogglingId(row.id);
    try {
      const r = await fetch(`/api/platform/rider-incentives/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !row.isActive })
      });
      if (!r.ok) throw new Error(await r.text());
      toast.success(row.isActive ? 'Slab paused' : 'Slab activated');
      router.refresh();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    } finally {
      setTogglingId(null);
    }
  }

  async function doDelete(row: IncentiveRow) {
    try {
      const r = await fetch(`/api/platform/rider-incentives/${row.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Slab deleted');
      setConfirmDelete(null);
      router.refresh();
    } catch (e) {
      toast.error('Failed to delete: ' + (e as Error).message);
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}><Plus className="size-4" /> New incentive</Button>
      </div>

      {initial.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No incentive slabs yet"
          description="Create your first delivery-target slab to reward riders with a flat bonus."
          action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> New incentive</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {initial.map((i) => (
            <Card key={i.id} className={i.isActive ? '' : 'opacity-70'}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{i.title}</div>
                    {i.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{i.description}</p>}
                  </div>
                  <Badge variant={i.period === 'DAILY' ? 'default' : 'warning'} className="text-[10px] shrink-0">{i.period}</Badge>
                </div>
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <span className="rounded-md border bg-card px-2 py-1">
                    <span className="text-muted-foreground">Target</span> <strong>{i.targetDeliveries} deliveries</strong>
                  </span>
                  <span className="rounded-md border bg-card px-2 py-1">
                    <span className="text-muted-foreground">Bonus</span> <strong>{money(i.bonusAmount)}</strong>
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(i.startsAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  {i.endsAt && <> — {new Date(i.endsAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</>}
                </div>
                <div className="flex items-center justify-between border-t pt-3">
                  <label className="flex items-center gap-2 text-xs">
                    {togglingId === i.id
                      ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      : <Switch checked={i.isActive} onCheckedChange={() => toggleActive(i)} />}
                    <span className="text-muted-foreground">{i.isActive ? 'Active' : 'Paused'}</span>
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(i)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button
                      size="sm" variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(i)}
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
        <IncentiveDialog
          row={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      {confirmDelete && (
        <Dialog open onOpenChange={(v) => !v && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete incentive slab</DialogTitle>
              <DialogDescription>
                Delete &ldquo;{confirmDelete.title}&rdquo;? This also removes all rider progress against it. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => doDelete(confirmDelete)}>Delete slab</Button>
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

function IncentiveDialog({ row, onClose, onSaved }: {
  row: IncentiveRow | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: row?.title ?? '',
    description: row?.description ?? '',
    period: row?.period ?? 'DAILY',
    targetDeliveries: row ? String(row.targetDeliveries) : '10',
    bonusAmount: row ? String(row.bonusAmount) : '100',
    startsAt: row ? toLocalInput(row.startsAt) : '',
    endsAt: row ? toLocalInput(row.endsAt) : '',
    isActive: row?.isActive ?? true
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (form.title.trim().length < 2) return toast.error('Title is required (≥ 2 chars).');
    const target = Number(form.targetDeliveries);
    const bonus = Number(form.bonusAmount);
    if (!Number.isInteger(target) || target < 1) return toast.error('Target deliveries must be a positive integer.');
    if (Number.isNaN(bonus) || bonus < 0) return toast.error('Bonus amount must be ≥ 0.');

    setSaving(true);
    try {
      const payload: any = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        period: form.period,
        targetDeliveries: target,
        bonusAmount: bonus,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        isActive: form.isActive
      };
      const r = await fetch(
        row ? `/api/platform/rider-incentives/${row.id}` : '/api/platform/rider-incentives',
        {
          method: row ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );
      if (!r.ok) throw new Error(await r.text());
      toast.success(row ? 'Incentive updated' : 'Incentive created');
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
          <DialogTitle>{row ? 'Edit incentive slab' : 'New incentive slab'}</DialogTitle>
          <DialogDescription>Riders hitting the delivery target within the period earn the flat bonus.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Weekend warrior" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Period</Label>
              <select
                value={form.period}
                onChange={(e) => set('period', e.target.value as 'DAILY' | 'WEEKLY')}
                className="h-10 mt-1 w-full rounded-md border bg-card px-2 text-sm"
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
              </select>
            </div>
            <div>
              <Label>Target deliveries</Label>
              <Input type="number" min={1} step={1} value={form.targetDeliveries} onChange={(e) => set('targetDeliveries', e.target.value)} />
            </div>
            <div>
              <Label>Bonus (₹)</Label>
              <Input type="number" min={0} step="0.01" value={form.bonusAmount} onChange={(e) => set('bonusAmount', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Starts at <span className="text-muted-foreground text-xs">(blank = now)</span></Label>
              <Input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            </div>
            <div>
              <Label>Ends at <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
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
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} {row ? 'Save changes' : 'Create incentive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
