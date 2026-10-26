'use client';
/**
 * Training library — platform list. Filter by audience / published state,
 * create a module (opens the full editor), toggle the rider shift gate.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Clock, GraduationCap, Languages, Loader2, Plus, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { reportApiError } from '@/lib/api-error';
import { AUDIENCE_LABEL, CATEGORY_LABEL, categoriesFor, type Audience } from './labels';

export interface ModuleRow {
  id: string;
  title: string;
  summary: string | null;
  category: string;
  audience: Audience;
  durationMin: number;
  order: number;
  isRequired: boolean;
  isActive: boolean;
  blocksShift: boolean;
  version: number;
  lessonsCount: number;
  questionCount: number;
  hasHindi: boolean;
  completedCount: number;
  progressCount: number;
}

const FILTERS: (Audience | 'ALL')[] = ['ALL', 'RIDER', 'KITCHEN', 'RESTAURANT_ADMIN'];

export function TrainingModulesClient({
  initial,
  shiftGate: initialGate,
  canEdit,
  canSeeDashboard,
}: {
  initial: ModuleRow[];
  shiftGate: boolean;
  canEdit: boolean;
  canSeeDashboard: boolean;
}) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience | 'ALL'>('ALL');
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [gate, setGate] = useState(initialGate);
  const [gateBusy, setGateBusy] = useState(false);

  const rows = useMemo(
    () => initial.filter((m) => (audience === 'ALL' || m.audience === audience) && (!publishedOnly || m.isActive)),
    [initial, audience, publishedOnly],
  );

  async function toggleGate(on: boolean) {
    setGateBusy(true);
    const r = await fetch('/api/platform/training-modules/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftGate: on }),
    });
    setGateBusy(false);
    if (!r.ok) return void (await reportApiError(r, 'Setting not saved'));
    setGate(on);
    toast.success(on ? 'Riders must pass shift-blocking modules before going online' : 'Shift gate turned off');
  }

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-start gap-3 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Block going online until safety training is passed</div>
            <p className="text-xs text-muted-foreground">
              When on, a rider can&apos;t go online until they hold a current certificate for every required rider module marked
              &ldquo;Blocks going online&rdquo;. Riders missing required training are always flagged in the platform rider list.
              {!canEdit && ' Only a super-admin can change this.'}
            </p>
          </div>
          <Switch checked={gate} onCheckedChange={toggleGate} disabled={!canEdit || gateBusy} aria-label="Training shift gate" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setAudience(f)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${audience === f ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'}`}
            >
              {f === 'ALL' ? 'All audiences' : AUDIENCE_LABEL[f]}
            </button>
          ))}
          <label className="ml-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={publishedOnly} onCheckedChange={setPublishedOnly} /> Published only
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            {canSeeDashboard && (
              <Button size="sm" variant="outline" asChild>
                <Link href="/platform/training-modules/dashboard">Completion dashboard</Link>
              </Button>
            )}
            {canEdit && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New module
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={GraduationCap} title="No training modules" description="Create a module, add lessons and a quiz, then publish it." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Module</th>
                    <th className="px-4 py-2.5 font-medium">Audience</th>
                    <th className="px-4 py-2.5 font-medium">Content</th>
                    <th className="px-4 py-2.5 font-medium">Flags</th>
                    <th className="px-4 py-2.5 font-medium">Certified (current)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((m) => (
                    <tr key={m.id} className="cursor-pointer hover:bg-muted/30" onClick={() => router.push(`/platform/training-modules/${m.id}`)}>
                      <td className="px-4 py-3">
                        <Link href={`/platform/training-modules/${m.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                          {m.title}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">
                          #{m.order} · {CATEGORY_LABEL[m.category] ?? m.category} · v{m.version}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{AUDIENCE_LABEL[m.audience]}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {m.durationMin} min</span>
                        <div>{m.lessonsCount} lessons · {m.questionCount} questions</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={m.isActive ? 'success' : 'muted'} className="text-[10px]">{m.isActive ? 'Published' : 'Draft'}</Badge>
                          {m.isRequired && <Badge variant="warning" className="text-[10px]">Required</Badge>}
                          {m.blocksShift && <Badge variant="destructive" className="text-[10px]">Blocks going online</Badge>}
                          {m.hasHindi && <Badge variant="secondary" className="text-[10px]"><Languages className="mr-1 size-3" />हिन्दी</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="inline-flex items-center gap-1 font-medium"><CheckCircle2 className="size-3 text-success" /> {m.completedCount}</span>
                        <span className="text-muted-foreground"> / {m.progressCount} started</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<Audience>('RIDER');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (title.trim().length < 2) return toast.error('Give the module a title.');
    setBusy(true);
    const r = await fetch('/api/platform/training-modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), audience, category: categoriesFor(audience)[0] }),
    });
    setBusy(false);
    if (!r.ok) return void (await reportApiError(r, 'Could not create module'));
    const { module } = await r.json();
    toast.success('Draft created. Add lessons, then publish.');
    router.push(`/platform/training-modules/${module.id}`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New training module</DialogTitle>
          <DialogDescription>It starts as an unpublished draft. You&apos;ll add lessons and a quiz next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="tm-title">Title</Label>
            <Input id="tm-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monsoon riding" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="tm-aud">Audience</Label>
            <select id="tm-aud" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className="mt-1 h-10 w-full rounded-md border bg-card px-2 text-sm">
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
                <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
