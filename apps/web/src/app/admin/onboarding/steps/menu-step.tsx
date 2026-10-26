'use client';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, LayoutTemplate, Loader2, PencilLine, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { reportApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { MENU_TEMPLATES, buildExampleCsv, type MenuTemplate } from '@/lib/onboarding/menu-templates';
import { StepFrame, Field, apiJson, SampleItemCard, VegDot } from '../parts';
import type { StepProps } from '../wizard-client';

type Path = 'template' | 'csv' | 'manual';
const PATHS: { key: Path; title: string; hint: string; icon: typeof LayoutTemplate }[] = [
  { key: 'template', title: 'Start from a template', hint: 'Pick your cuisine, edit names and prices, add in one click.', icon: LayoutTemplate },
  { key: 'csv', title: 'Import a spreadsheet', hint: 'Already have your menu in Excel/Sheets? Upload a CSV.', icon: FileSpreadsheet },
  { key: 'manual', title: 'Add dishes one by one', hint: 'Best for a small menu or a few signature dishes.', icon: PencilLine },
];

export function MenuStep({ data, complete, refresh }: StepProps) {
  const [path, setPath] = useState<Path>(data.menu.itemCount > 0 ? 'manual' : 'template');
  const ready = data.menu.availableCount > 0;
  const accent = data.storefront.branding.accentColor;

  return (
    <StepFrame
      title="Menu"
      intro={`Choose whichever is fastest for you — you can mix them, and everything stays editable later under Menu.${data.branches.filter((b) => b.isActive).length > 1 ? ' Dishes are added to your first branch; copy them to others from the menu editor.' : ''}`}
      why="Customers can only order dishes that are marked available and priced above ₹0. Clear names, honest descriptions and veg/non-veg marks reduce wrong orders and refunds."
      example={<>Category <b>Main Course</b> → dish <b>Paneer Butter Masala</b>, ₹280, veg, mild, “Paneer in a buttery tomato-cashew gravy.” Customers see it exactly like the card below.</>}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {PATHS.map((p) => (
          <button key={p.key} type="button" onClick={() => setPath(p.key)}
            className={cn('rounded-xl border p-3 text-left transition-colors', path === p.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent')}>
            <p.icon className="size-5 text-primary" />
            <div className="mt-1.5 text-sm font-semibold">{p.title}</div>
            <div className="text-xs text-muted-foreground">{p.hint}</div>
          </button>
        ))}
      </div>

      {path === 'template' && <TemplatePath accent={accent} onApplied={refresh} />}
      {path === 'csv' && <CsvPath onApplied={refresh} />}
      {path === 'manual' && <ManualPath accent={accent} categories={data.menu.categories} onApplied={refresh} />}

      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-semibold">Your menu now:</span> {data.menu.itemCount} dish{data.menu.itemCount === 1 ? '' : 'es'} in {data.menu.categories.length} categor{data.menu.categories.length === 1 ? 'y' : 'ies'}, {data.menu.availableCount} available to order.
          </div>
          <a href="/admin/menu" className="text-xs text-primary hover:underline">Open full menu editor (photos, sizes, add-ons)</a>
        </div>
        {data.menu.recent.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {data.menu.recent.slice(0, 4).map((it, idx) => <SampleItemCard key={idx} item={it} accent={accent} />)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!ready && <span className="text-xs text-muted-foreground">Add at least one available dish to continue.</span>}
        <Button onClick={complete} disabled={!ready}>Continue</Button>
      </div>
    </StepFrame>
  );
}

// ── Template path ────────────────────────────────────────────────────────────

interface Row { include: boolean; name: string; price: string; category: string }

function TemplatePath({ accent, onApplied }: { accent: string; onApplied: () => void }) {
  const [tpl, setTpl] = useState<MenuTemplate>(MENU_TEMPLATES[0]!);
  const [rows, setRows] = useState<Row[]>(() => toRows(MENU_TEMPLATES[0]!));
  const [busy, setBusy] = useState(false);
  function toRows(t: MenuTemplate): Row[] { return t.items.map((i) => ({ include: true, name: i.name, price: String(i.price), category: i.category })); }
  const pick = (t: MenuTemplate) => { setTpl(t); setRows(toRows(t)); };
  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const rowError = (r: Row) => (!r.include ? null : !r.name.trim() ? 'Name required' : !(Number(r.price) > 0) ? 'Price must be above ₹0' : null);
  const errors = rows.map(rowError);
  const included = rows.filter((r) => r.include).length;
  const firstIncluded = rows.findIndex((r) => r.include);

  async function apply() {
    if (errors.some(Boolean)) { toast.error('Fix the highlighted rows first.'); return; }
    if (included === 0) { toast.error('Tick at least one dish.'); return; }
    setBusy(true);
    const res = await apiJson<{ created: number; updated: number; categoriesCreated: number }>('/api/admin/onboarding/menu-template', 'POST', {
      templateId: tpl.id,
      selections: rows.map((r, index) => ({ index, include: r.include, name: r.name, price: Number(r.price), category: r.category })),
    }, 'Could not add the template');
    setBusy(false);
    if (res) {
      toast.success(`Added ${res.created} dish${res.created === 1 ? '' : 'es'}${res.updated ? `, updated ${res.updated}` : ''} in ${res.categoriesCreated} new categor${res.categoriesCreated === 1 ? 'y' : 'ies'}.`);
      onApplied();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
        {MENU_TEMPLATES.map((t) => (
          <button key={t.id} type="button" onClick={() => pick(t)}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium', t.id === tpl.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>
            {t.title}
          </button>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
        <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" />
        <div><b>These are editable samples</b> — typical {tpl.title} dishes at typical city prices. Untick what you don&apos;t serve and change names and prices to match your real menu before adding. {tpl.blurb}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full max-w-full min-w-[520px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2 w-10">Add</th><th className="p-2">Dish</th><th className="p-2">Category</th><th className="p-2 w-28">Price (₹)</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={cn('border-t align-top', !r.include && 'opacity-50')}>
                  <td className="p-2"><input type="checkbox" aria-label={`Include ${r.name}`} checked={r.include} onChange={(e) => patch(i, { include: e.target.checked })} className="mt-2.5 size-4" /></td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5"><VegDot veg={tpl.items[i]!.isVeg} /><Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className="h-9" /></div>
                    {errors[i] && <div className="text-[11px] text-destructive mt-1">{errors[i]}</div>}
                  </td>
                  <td className="p-2"><Input value={r.category} onChange={(e) => patch(i, { category: e.target.value })} className="h-9" /></td>
                  <td className="p-2"><Input inputMode="decimal" value={r.price} onChange={(e) => patch(i, { price: e.target.value })} className="h-9" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How a dish will look</div>
          {firstIncluded >= 0 && (
            <SampleItemCard sample accent={accent} item={{ ...tpl.items[firstIncluded]!, name: rows[firstIncluded]!.name, price: Number(rows[firstIncluded]!.price) || 0, category: rows[firstIncluded]!.category }} />
          )}
          <p className="text-[11px] text-muted-foreground">Add photos later in the menu editor — dishes with photos sell noticeably better.</p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={apply} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Add {included} dish{included === 1 ? '' : 'es'} to my menu</Button>
      </div>
    </div>
  );
}

// ── CSV path ─────────────────────────────────────────────────────────────────

interface DiffRow { index: number; action: 'create' | 'update' | 'error'; category: string; name: string; price?: number; errors: string[] }
interface ParsedRow { category: string; name: string; description?: string; price?: number; isVeg?: boolean; spicyLevel?: number; prepTimeMin?: number; isAvailable?: boolean }

function CsvPath({ onApplied }: { onApplied: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [diff, setDiff] = useState<DiffRow[] | null>(null);
  const good = useMemo(() => (diff ?? []).filter((d) => d.action !== 'error').length, [diff]);
  const bad = (diff ?? []).filter((d) => d.action === 'error');

  function downloadExample() {
    const blob = new Blob([buildExampleCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'flavrly-menu-example.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function preview() {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error('Choose a .csv or .xlsx file first.'); return; }
    setBusy(true); setRows(null); setDiff(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const r = await fetch('/api/admin/menu/import', { method: 'POST', body });
      if (!r.ok) { await reportApiError(r, 'Could not read that file'); return; }
      const j = await r.json();
      if (j.notice) toast.message(j.notice);
      setRows(j.rows); setDiff(j.diff);
    } catch {
      toast.error('Upload failed — check your connection and retry.');
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!rows || !diff) return;
    const valid = rows.filter((_, i) => diff[i]?.action !== 'error');
    if (valid.length === 0) { toast.error('No valid rows to import — fix the errors and re-upload.'); return; }
    setBusy(true);
    const res = await apiJson<{ created: number; updated: number; skipped: number }>('/api/admin/menu/import/apply', 'POST', { rows: valid }, 'Import failed');
    setBusy(false);
    if (res) {
      toast.success(`Imported: ${res.created} new, ${res.updated} updated.`);
      setRows(null); setDiff(null);
      if (fileRef.current) fileRef.current.value = '';
      onApplied();
    }
  }

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Download the example file and open it in Excel or Google Sheets.</li>
        <li>Keep the header row. One dish per row: <b>Category, Item Name, Price</b> are required; Veg is “Veg” or “Non-Veg”; Spicy Level 0–3; Available “Yes”/“No”.</li>
        <li>Save as CSV (or .xlsx) and upload. We check every row and show exactly what to fix before anything is saved.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={downloadExample}><Download className="size-4" /> Example CSV</Button>
        <Button asChild variant="ghost"><a href="/api/admin/menu/template">Blank Excel template</a></Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm" />
        <Button type="button" onClick={preview} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Check file</Button>
      </div>

      {diff && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="success">{good} ready</Badge>
            {bad.length > 0 && <Badge variant="destructive">{bad.length} with errors</Badge>}
          </div>
          {bad.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-destructive/30">
              <table className="w-full max-w-full min-w-[420px] text-sm">
                <thead className="bg-destructive/5 text-left text-xs"><tr><th className="p-2 w-16">Row</th><th className="p-2">Dish</th><th className="p-2">What to fix</th></tr></thead>
                <tbody>
                  {bad.map((d) => (
                    <tr key={d.index} className="border-t">
                      {/* +1: the header is row 1 in the spreadsheet. */}
                      <td className="p-2 font-mono">{d.index + 1}</td>
                      <td className="p-2">{d.name || <span className="text-muted-foreground">(blank)</span>}</td>
                      <td className="p-2 text-destructive">{d.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {bad.length > 0 && <span className="text-xs text-muted-foreground">Rows with errors are skipped. Fix and re-upload to include them.</span>}
            <Button onClick={apply} disabled={busy || good === 0}>{busy && <Loader2 className="size-4 animate-spin" />} Import {good} row{good === 1 ? '' : 's'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manual path ──────────────────────────────────────────────────────────────

function ManualPath({ accent, categories, onApplied }: { accent: string; categories: string[]; onApplied: () => void }) {
  const blank = { category: categories[0] ?? 'Main Course', name: '', description: '', price: '', isVeg: true, spicyLevel: 0, prepTimeMin: 20 };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const errors = {
    category: f.category.trim() ? null : 'Category is required, e.g. Starters.',
    name: f.name.trim() ? null : 'Dish name is required.',
    price: Number(f.price) > 0 ? null : 'Enter a price above ₹0, e.g. 280.',
  };
  const invalid = Object.values(errors).some(Boolean);

  async function add() {
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    const res = await apiJson('/api/admin/menu/import/apply', 'POST', {
      rows: [{ category: f.category.trim(), name: f.name.trim(), description: f.description.trim() || undefined, price: Number(f.price), isVeg: f.isVeg, spicyLevel: f.spicyLevel, prepTimeMin: f.prepTimeMin, isAvailable: true }],
    }, 'Could not add the dish');
    setBusy(false);
    if (res) {
      toast.success(`${f.name} added`);
      setAdded((a) => [f.name, ...a]);
      setF({ ...blank, category: f.category });
      setTouched(false);
      onApplied();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required error={touched ? errors.category : null} hint="Pick one or type a new one.">
          <Input list="onb-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Main Course" />
          <datalist id="onb-categories">
            {[...new Set([...categories, 'Starters', 'Main Course', 'Breads', 'Rice & Biryani', 'Desserts', 'Beverages'])].map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field label="Dish name" required error={touched ? errors.name : null}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Paneer Butter Masala" />
        </Field>
        <Field label="Description" className="sm:col-span-2" hint="What's in it, portion size. e.g. “Paneer in a buttery tomato-cashew gravy. Serves 1–2.”">
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Paneer in a buttery tomato-cashew gravy." />
        </Field>
        <Field label="Price (₹)" required error={touched ? errors.price : null}>
          <Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="280" />
        </Field>
        <Field label="Spice level" hint="0 none · 1 mild · 2 medium · 3 hot">
          <select value={f.spicyLevel} onChange={(e) => setF({ ...f, spicyLevel: Number(e.target.value) })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{['None', 'Mild', 'Medium', 'Hot'][n]}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.isVeg} onCheckedChange={(v) => setF({ ...f, isVeg: v })} /> <VegDot veg={f.isVeg} /> {f.isVeg ? 'Vegetarian' : 'Non-vegetarian'}
        </label>
        <Field label="Prep time (minutes)">
          <Input type="number" min={1} max={180} value={f.prepTimeMin} onChange={(e) => setF({ ...f, prepTimeMin: Number(e.target.value) || 20 })} />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button onClick={add} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Add dish</Button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live preview</div>
        <SampleItemCard accent={accent} item={{ name: f.name || 'Paneer Butter Masala', description: f.description || 'Paneer in a buttery tomato-cashew gravy.', price: Number(f.price) || 280, isVeg: f.isVeg, category: f.category }} sample={!f.name} />
        {added.length > 0 && (
          <ul className="space-y-1 text-xs">
            {added.map((n, i) => <li key={i} className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-3.5" /> {n}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
