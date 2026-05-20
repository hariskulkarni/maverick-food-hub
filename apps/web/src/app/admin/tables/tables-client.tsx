'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { Plus, Pencil, Power, Armchair } from 'lucide-react';

interface TableRow {
  id: string;
  name: string;
  capacity: number;
  sortOrder: number;
  isActive: boolean;
}

export function TablesClient({
  dineInEnabled, initialTables
}: { dineInEnabled: boolean; initialTables: TableRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TableRow | null>(null);
  const [open, setOpen] = useState(false);

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(t: TableRow) { setEditing(t); setOpen(true); }

  async function toggleActive(t: TableRow) {
    const r = await fetch(`/api/admin/tables/${t.id}`, {
      method: t.isActive ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: t.isActive ? undefined : JSON.stringify({ isActive: true })
    });
    if (!r.ok) return toast.error('Update failed: ' + (await r.text()));
    toast.success(t.isActive ? 'Table deactivated' : 'Table reactivated');
    router.refresh();
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Armchair className="size-5" />
          </div>
          <div>
            <h1 className="display text-2xl font-semibold">Tables</h1>
            <p className="text-sm text-muted-foreground">Manage the tables guests can reserve for dine-in.</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="size-4" /> Add table</Button>
          </DialogTrigger>
          <TableDialog editing={editing} onDone={() => { setOpen(false); router.refresh(); }} />
        </Dialog>
      </header>

      {!dineInEnabled && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Dine-in reservations are currently turned off. You can still set up tables here; enable dine-in in{' '}
          <span className="font-medium">Settings → Order flow</span> to start taking reservations.
        </div>
      )}

      {initialTables.length === 0 ? (
        <Card><CardContent className="p-0">
          <EmptyState
            icon={Armchair}
            title="No tables yet"
            description="Add your first table to start accepting dine-in reservations."
          />
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {initialTables.map((t) => (
            <Card key={t.id} className={t.isActive ? '' : 'opacity-60'}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {!t.isActive && <Badge variant="muted">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">Seats {t.capacity} · order {t.sortOrder}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(t)} title={t.isActive ? 'Deactivate' : 'Reactivate'}>
                    <Power className={`size-4 ${t.isActive ? 'text-destructive' : 'text-success'}`} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TableDialog({ editing, onDone }: { editing: TableRow | null; onDone: () => void }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [capacity, setCapacity] = useState(editing?.capacity ?? 2);
  const [sortOrder, setSortOrder] = useState(editing?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = JSON.stringify({ name, capacity, sortOrder, isActive });
      const r = editing
        ? await fetch(`/api/admin/tables/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
        : await fetch('/api/admin/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) return toast.error('Save failed: ' + (await r.text()));
      toast.success(editing ? 'Table updated' : 'Table added');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit table' : 'Add table'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="T1, Window 4, Patio A" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Capacity (seats)</Label>
            <Input type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Sort order</Label>
            <Input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm">Active</Label>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : editing ? 'Save table' : 'Add table'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
