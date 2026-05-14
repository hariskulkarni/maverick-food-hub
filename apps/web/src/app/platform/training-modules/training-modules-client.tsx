'use client';
/**
 * Training modules CRUD explorer. Filter by category / active state; the
 * table doubles as a completion dashboard (completed vs in-progress counts
 * from RiderTrainingProgress). "New module" and row click open a drawer with
 * the full editable form; delete is behind an inline confirm.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { GraduationCap, Plus, Loader2, Save, Trash2, CheckCircle2, Clock } from 'lucide-react';

type Category = 'ONBOARDING' | 'SAFETY' | 'CUSTOMER_SERVICE' | 'EARNINGS' | 'APP_GUIDE';

interface ModuleRow {
  id: string;
  title: string;
  summary: string | null;
  category: Category;
  contentBody: string;
  quizQuestions: any | null;
  durationMin: number;
  order: number;
  isRequired: boolean;
  isActive: boolean;
  createdAt: string;
  completedCount: number;
  progressCount: number;
}

const CATEGORIES: Category[] = ['ONBOARDING', 'SAFETY', 'CUSTOMER_SERVICE', 'EARNINGS', 'APP_GUIDE'];
const CATEGORY_FILTERS: (Category | 'ALL')[] = ['ALL', ...CATEGORIES];

type Draft = {
  title: string;
  summary: string;
  category: Category;
  contentBody: string;
  durationMin: string;
  order: string;
  isRequired: boolean;
  isActive: boolean;
};

function emptyDraft(): Draft {
  return {
    title: '',
    summary: '',
    category: 'ONBOARDING',
    contentBody: '',
    durationMin: '10',
    order: '0',
    isRequired: false,
    isActive: true,
  };
}

function draftFrom(m: ModuleRow): Draft {
  return {
    title: m.title,
    summary: m.summary ?? '',
    category: m.category,
    contentBody: m.contentBody,
    durationMin: String(m.durationMin),
    order: String(m.order),
    isRequired: m.isRequired,
    isActive: m.isActive,
  };
}

export function TrainingModulesClient({ initial }: { initial: ModuleRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ModuleRow[]>(initial);
  const [category, setCategory] = useState<Category | 'ALL'>('ALL');
  const [activeOnly, setActiveOnly] = useState(false);
  const [editing, setEditing] = useState<ModuleRow | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let r = rows.slice();
    if (category !== 'ALL') r = r.filter((x) => x.category === category);
    if (activeOnly) r = r.filter((x) => x.isActive);
    return r;
  }, [rows, category, activeOnly]);

  function upsert(m: ModuleRow) {
    setRows((prev) => {
      const exists = prev.some((x) => x.id === m.id);
      const next = exists ? prev.map((x) => (x.id === m.id ? m : x)) : [...prev, m];
      return next.sort((a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt));
    });
  }

  function remove(id: string) {
    setRows((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Category:</span>
            {CATEGORY_FILTERS.map((c) => (
              <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c === 'ALL' ? 'All' : prettyCategory(c as Category)}
              </Chip>
            ))}
            <label className="ml-3 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
              Active only
            </label>
            <span className="text-xs text-muted-foreground ml-auto mr-2">
              {filtered.length} module{filtered.length === 1 ? '' : 's'}
            </span>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New module
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={GraduationCap}
                title="No training modules"
                description="Create a module to start delivering content to riders."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <Th>#</Th>
                    <Th>Title</Th>
                    <Th>Category</Th>
                    <Th>Duration</Th>
                    <Th>Flags</Th>
                    <Th>Completion</Th>
                    <th className="text-right px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setEditing(m)}>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">{m.order}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-xs">{m.title}</div>
                        {m.summary && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[260px]">{m.summary}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-[10px]">
                          {prettyCategory(m.category)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {m.durationMin} min
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {m.isRequired && (
                            <Badge variant="warning" className="text-[10px]">
                              Required
                            </Badge>
                          )}
                          <Badge variant={m.isActive ? 'success' : 'muted'} className="text-[10px]">
                            {m.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <CheckCircle2 className="size-3 text-success" />
                          {m.completedCount}
                        </span>
                        <span className="text-muted-foreground"> / {m.progressCount} started</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(m);
                          }}
                        >
                          Edit
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

      {creating && (
        <ModuleDrawer
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={(m) => {
            upsert(m);
            setCreating(false);
            router.refresh();
          }}
        />
      )}

      {editing && (
        <ModuleDrawer
          mode="edit"
          module={editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            upsert(m);
            setEditing(null);
            router.refresh();
          }}
          onDeleted={(id) => {
            remove(id);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ModuleDrawer({
  mode,
  module: mod,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: 'create' | 'edit';
  module?: ModuleRow;
  onClose: () => void;
  onSaved: (m: ModuleRow) => void;
  onDeleted?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(mod ? draftFrom(mod) : emptyDraft());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function validate(): string | null {
    if (draft.title.trim().length < 2) return 'Title must be at least 2 characters.';
    if (!draft.contentBody.trim()) return 'Content body is required.';
    const dur = Number(draft.durationMin);
    if (!Number.isInteger(dur) || dur < 1 || dur > 600) return 'Duration must be 1–600 minutes.';
    const ord = Number(draft.order);
    if (!Number.isInteger(ord) || ord < 0 || ord > 9999) return 'Order must be 0–9999.';
    return null;
  }

  async function save() {
    const err = validate();
    if (err) return toast.error(err);
    setBusy(true);
    const payload = {
      title: draft.title.trim(),
      summary: draft.summary.trim() || null,
      category: draft.category,
      contentBody: draft.contentBody,
      durationMin: Number(draft.durationMin),
      order: Number(draft.order),
      isRequired: draft.isRequired,
      isActive: draft.isActive,
    };
    const r =
      mode === 'create'
        ? await fetch('/api/platform/training-modules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/platform/training-modules/${mod!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
    setBusy(false);
    if (!r.ok) return toast.error(`Save failed: ${await r.text()}`);
    const { module: saved } = await r.json();
    toast.success(mode === 'create' ? 'Module created' : 'Module updated');
    onSaved(saved);
  }

  async function del() {
    if (!mod) return;
    setBusy(true);
    const r = await fetch(`/api/platform/training-modules/${mod.id}`, { method: 'DELETE' });
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) return toast.error(`Delete failed: ${await r.text()}`);
    toast.success('Module deleted');
    onDeleted?.(mod.id);
  }

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={mode === 'create' ? 'New training module' : draft.title || 'Edit module'}
      subtitle={mode === 'edit' && mod ? `Created ${new Date(mod.createdAt).toLocaleDateString('en-IN')}` : 'Fill in the details below'}
      badge={
        mode === 'edit' && mod ? (
          <Badge variant={mod.isActive ? 'success' : 'muted'} className="text-[10px]">
            {mod.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ) : undefined
      }
      width="620px"
      footer={
        confirmDelete ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground mr-auto">
              Delete this module? Rider progress rows will be removed too.
            </span>
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Back
            </Button>
            <Button size="sm" variant="destructive" onClick={del} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Confirm delete
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {mode === 'edit' && (
              <Button
                size="sm"
                variant="outline"
                className="mr-auto text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}{' '}
              {mode === 'create' ? 'Create module' : 'Save changes'}
            </Button>
          </div>
        )
      }
    >
      {mode === 'edit' && mod && (
        <DrawerSection title="Completion">
          <div className="p-4 grid grid-cols-2 gap-y-1.5 text-sm">
            <span className="text-muted-foreground text-xs">Completed</span>
            <span className="text-right font-semibold tabular-nums">{mod.completedCount}</span>
            <span className="text-muted-foreground text-xs">In progress / started</span>
            <span className="text-right tabular-nums">{mod.progressCount}</span>
          </div>
        </DrawerSection>
      )}

      <DrawerSection title="Details">
        <div className="p-4 space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Title</Label>
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} className="mt-1 h-9" placeholder="e.g. Road safety basics" />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Summary</Label>
            <Input
              value={draft.summary}
              onChange={(e) => set('summary', e.target.value)}
              className="mt-1 h-9"
              placeholder="Short one-line description (optional)"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[180px]">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Category</Label>
              <select
                value={draft.category}
                onChange={(e) => set('category', e.target.value as Category)}
                className="h-9 mt-1 w-full rounded-md border bg-card px-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {prettyCategory(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Duration (min)</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={draft.durationMin}
                onChange={(e) => set('durationMin', e.target.value)}
                className="mt-1 h-9 w-32"
              />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Order</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                value={draft.order}
                onChange={(e) => set('order', e.target.value)}
                className="mt-1 h-9 w-24"
              />
            </div>
          </div>
        </div>
      </DrawerSection>

      <DrawerSection title="Content">
        <div className="p-4">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Content body</Label>
          <Textarea
            value={draft.contentBody}
            onChange={(e) => set('contentBody', e.target.value)}
            placeholder="The module content riders will read."
            className="mt-1 min-h-[160px]"
          />
        </div>
      </DrawerSection>

      <DrawerSection title="Settings">
        <div className="p-4 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium">Required</div>
              <div className="text-xs text-muted-foreground">Riders must complete this module.</div>
            </div>
            <Switch checked={draft.isRequired} onCheckedChange={(v) => set('isRequired', v)} />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">Visible to riders in the app.</div>
            </div>
            <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} />
          </label>
        </div>
      </DrawerSection>
    </DetailDrawer>
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

function prettyCategory(c: Category): string {
  return {
    ONBOARDING: 'Onboarding',
    SAFETY: 'Safety',
    CUSTOMER_SERVICE: 'Customer service',
    EARNINGS: 'Earnings',
    APP_GUIDE: 'App guide',
  }[c];
}
