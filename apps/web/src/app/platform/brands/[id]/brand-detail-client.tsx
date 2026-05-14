'use client';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { ArrowLeft, Trash2, Plus, Layers, Loader2, Save, ExternalLink, BarChart3 } from 'lucide-react';
import { money } from '@/lib/utils';

interface BrandLite {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  createdAt: string;
}
interface CuisineRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  cuisine: string | null;
  branchCount: number;
}
interface ReportRow { key: string; label: string; revenue: number; orders: number }
interface ReportResult {
  brand: { revenue: number; orders: number };
  cuisine: ReportRow[];
  branch: ReportRow[];
  item: ReportRow[];
  range: { from: string; to: string };
}

export function BrandDetailClient({
  brand: initialBrand,
  cuisines: initialCuisines,
  unassigned: initialUnassigned,
  initialReport
}: {
  brand: BrandLite;
  cuisines: CuisineRow[];
  unassigned: { id: string; name: string; slug: string; cuisine: string | null; branchCount: number }[];
  initialReport: ReportResult;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState(initialBrand);

  return (
    <>
      <div className="flex items-center gap-3">
        <Link href="/platform/brands" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> All brands
        </Link>
      </div>

      <header className="flex flex-wrap items-start gap-4">
        <div className="relative size-16 rounded-xl overflow-hidden border bg-muted shrink-0">
          {brand.logoUrl
            ? <Image src={brand.logoUrl} alt="" fill sizes="64px" className="object-cover" />
            : <div className="grid h-full w-full place-items-center text-muted-foreground"><Layers className="size-6" /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="display text-3xl font-semibold leading-tight truncate">{brand.name}</h1>
          <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
            <span>/{brand.slug}</span>
            <Badge variant={brand.status === 'ACTIVE' ? 'success' : brand.status === 'SUSPENDED' ? 'destructive' : 'muted'} className="text-[10px]">{brand.status}</Badge>
          </div>
          {brand.tagline && <p className="text-sm text-muted-foreground mt-1">{brand.tagline}</p>}
        </div>
        <a href={`/brand/${brand.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          <ExternalLink className="size-3.5" /> Preview public
        </a>
      </header>

      <Tabs defaultValue="cuisines">
        <TabsList>
          <TabsTrigger value="cuisines">Cuisines ({initialCuisines.length})</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="cuisines">
          <CuisinesTab
            brandId={brand.id}
            cuisines={initialCuisines}
            unassigned={initialUnassigned}
            onChanged={() => router.refresh()}
          />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsTab brandId={brand.id} initial={initialReport} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab brand={brand} onUpdated={(b) => setBrand(b)} onDeactivated={() => router.push('/platform/brands')} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ─── Cuisines tab ──────────────────────────────────────────────────────────
function CuisinesTab({
  brandId, cuisines, unassigned, onChanged
}: {
  brandId: string;
  cuisines: CuisineRow[];
  unassigned: { id: string; name: string; slug: string; cuisine: string | null; branchCount: number }[];
  onChanged: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);

  async function unassign(restaurantId: string) {
    if (!confirm('Remove this cuisine from the brand?')) return;
    setWorking(restaurantId);
    try {
      const r = await fetch(`/api/platform/brands/${brandId}/restaurants/${restaurantId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Unassigned');
      onChanged();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    } finally {
      setWorking(null);
    }
  }

  async function assignPicked(force = false) {
    if (picked.size === 0) return setPickerOpen(false);
    try {
      const r = await fetch(`/api/platform/brands/${brandId}/restaurants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restaurantIds: Array.from(picked), force })
      });
      if (r.status === 409) {
        const j = await r.json();
        if (j.error === 'ALREADY_ASSIGNED' && confirm('Some restaurants are already assigned to another brand. Re-parent them?')) {
          return assignPicked(true);
        }
        return toast.error(j.message ?? 'Conflict');
      }
      if (!r.ok) throw new Error(await r.text());
      toast.success(`Assigned ${picked.size} cuisine${picked.size === 1 ? '' : 's'}`);
      setPicked(new Set());
      setPickerOpen(false);
      onChanged();
    } catch (e) {
      toast.error('Failed: ' + (e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Cuisines grouped under this brand. Each keeps its own menu, branches and operations.</p>
        <Button size="sm" onClick={() => setPickerOpen(true)} disabled={unassigned.length === 0}>
          <Plus className="size-4" /> Assign more
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {cuisines.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No cuisines assigned yet. Use <strong>Assign more</strong> to add one.
            </div>
          ) : (
            <ul className="divide-y text-sm">
              {cuisines.map((c) => (
                <li key={c.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {c.name}
                      <Badge variant={c.status === 'ACTIVE' ? 'success' : 'muted'} className="text-[10px]">{c.status}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      /{c.slug} · {c.cuisine ?? 'No cuisine tag'} · {c.branchCount} branch{c.branchCount === 1 ? '' : 'es'}
                    </div>
                  </div>
                  <Link href={`/platform/restaurants?q=${encodeURIComponent(c.slug)}`} className="text-xs text-primary hover:underline">Open</Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/40 hover:bg-destructive/5"
                    onClick={() => unassign(c.id)}
                    disabled={working === c.id}
                  >
                    <Trash2 className="size-3.5" /> {working === c.id ? '…' : 'Unassign'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {pickerOpen && (
        <Dialog open onOpenChange={(v) => !v && setPickerOpen(false)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Assign cuisines</DialogTitle>
              <DialogDescription>Pick from solo (unassigned) restaurants. Only ACTIVE ones are listed.</DialogDescription>
            </DialogHeader>
            <div className="max-h-[400px] overflow-y-auto -mx-6 px-6">
              {unassigned.length === 0 ? (
                <p className="text-sm text-muted-foreground p-6 text-center">No unassigned active restaurants.</p>
              ) : (
                <ul className="divide-y">
                  {unassigned.map((r) => {
                    const on = picked.has(r.id);
                    return (
                      <li key={r.id} className="py-2.5 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setPicked((s) => {
                            const n = new Set(s);
                            on ? n.delete(r.id) : n.add(r.id);
                            return n;
                          })}
                          className="size-4 accent-[hsl(var(--primary))]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{r.name}</div>
                          <div className="text-[11px] text-muted-foreground truncate">/{r.slug} · {r.cuisine ?? 'No cuisine'} · {r.branchCount} branches</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
              <Button onClick={() => assignPicked(false)} disabled={picked.size === 0}>Assign {picked.size > 0 ? `(${picked.size})` : ''}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Reports tab ───────────────────────────────────────────────────────────
const PRESETS = [
  { key: '7d',  label: '7 days',  days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 }
] as const;
const LEVELS = [
  { key: 'brand',   label: 'Brand-level' },
  { key: 'cuisine', label: 'Cuisine' },
  { key: 'branch',  label: 'Branch' },
  { key: 'item',    label: 'Item' }
] as const;

function ReportsTab({ brandId, initial }: { brandId: string; initial: ReportResult }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [level, setLevel] = useState<'brand' | 'cuisine' | 'branch' | 'item'>('brand');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportResult>(initial);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const to = new Date();
        const from = new Date(to.getTime() - days * 86_400_000);
        // We need full rollup data for the picker UI; the API returns brand totals plus the
        // selected slice. We fetch each level the user opens.
        const r = await fetch(`/api/platform/brands/${brandId}/reports?from=${from.toISOString()}&to=${to.toISOString()}&level=cuisine`);
        if (!r.ok) throw new Error(await r.text());
        const cuisineSlice = await r.json();

        // Fetch the other slices in parallel
        const [branchRes, itemRes] = await Promise.all([
          fetch(`/api/platform/brands/${brandId}/reports?from=${from.toISOString()}&to=${to.toISOString()}&level=branch`),
          fetch(`/api/platform/brands/${brandId}/reports?from=${from.toISOString()}&to=${to.toISOString()}&level=item`)
        ]);
        const branchSlice = branchRes.ok ? await branchRes.json() : { data: [] };
        const itemSlice   = itemRes.ok   ? await itemRes.json()   : { data: [] };

        if (cancelled) return;
        setReport({
          brand: cuisineSlice.brand,
          cuisine: cuisineSlice.data,
          branch:  branchSlice.data,
          item:    itemSlice.data,
          range:   cuisineSlice.range
        });
      } catch (e) {
        if (!cancelled) toast.error('Reports failed: ' + (e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [days, brandId]);

  const rows: ReportRow[] = useMemo(() => {
    if (level === 'brand') return [{ key: brandId, label: 'Brand total', revenue: report.brand.revenue, orders: report.brand.orders }];
    return report[level];
  }, [level, report, brandId]);

  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setDays(p.days as 7 | 30 | 90)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                days === p.days ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-muted-foreground inline-flex items-center gap-2">
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          Range: {new Date(report.range.from).toLocaleDateString('en-IN')} → {new Date(report.range.to).toLocaleDateString('en-IN')}
        </div>
      </div>

      <Card>
        <CardContent className="p-5 grid gap-4 md:grid-cols-3">
          <Stat label="Brand revenue" value={money(report.brand.revenue)} />
          <Stat label="Orders" value={report.brand.orders.toLocaleString('en-IN')} />
          <Stat label="Avg order value" value={money(report.brand.orders ? report.brand.revenue / report.brand.orders : 0)} />
        </CardContent>
      </Card>

      <Tabs value={level} onValueChange={(v) => setLevel(v as any)}>
        <TabsList>
          {LEVELS.map((l) => <TabsTrigger key={l.key} value={l.key}>{l.label}</TabsTrigger>)}
        </TabsList>
        {LEVELS.map((l) => (
          <TabsContent key={l.key} value={l.key}>
            <Card>
              <CardContent className="p-4">
                {rows.length === 0 ? (
                  <EmptyState icon={BarChart3} title="No data in this range" description="Try a wider window or another level." />
                ) : (
                  <ul className="space-y-2">
                    {rows.slice(0, 20).map((r) => (
                      <li key={r.key} className="space-y-1">
                        <div className="flex items-center gap-3 text-sm">
                          <span className="flex-1 min-w-0 truncate">{r.label}</span>
                          <span className="text-muted-foreground tabular-nums text-[11px]">{r.orders} orders</span>
                          <span className="tabular-nums font-medium w-24 text-right">{money(r.revenue)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${Math.round((r.revenue / maxRevenue) * 100)}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold text-lg">{value}</div>
    </div>
  );
}

// ─── Settings tab ──────────────────────────────────────────────────────────
function SettingsTab({
  brand, onUpdated, onDeactivated
}: {
  brand: BrandLite;
  onUpdated: (b: BrandLite) => void;
  onDeactivated: () => void;
}) {
  const [form, setForm] = useState({
    name:          brand.name,
    tagline:       brand.tagline ?? '',
    description:   brand.description ?? '',
    logoUrl:       brand.logoUrl ?? '',
    coverImageUrl: brand.coverImageUrl ?? '',
    contactEmail:  brand.contactEmail ?? '',
    contactPhone:  brand.contactPhone ?? ''
  });
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        tagline:       form.tagline.trim()       || null,
        description:   form.description.trim()   || null,
        logoUrl:       form.logoUrl.trim()       || null,
        coverImageUrl: form.coverImageUrl.trim() || null,
        contactEmail:  form.contactEmail.trim()  || null,
        contactPhone:  form.contactPhone.trim()  || null
      };
      const r = await fetch(`/api/platform/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error(await r.text());
      const updated = await r.json();
      toast.success('Brand updated');
      onUpdated({ ...brand, ...updated });
    } catch (e) {
      toast.error('Save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!confirm('Deactivate this brand? Cuisines stay assigned but the brand is marked SUSPENDED.')) return;
    setDeactivating(true);
    try {
      const r = await fetch(`/api/platform/brands/${brand.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      toast.success('Brand deactivated');
      onDeactivated();
    } catch (e) {
      toast.error('Deactivate failed: ' + (e as Error).message);
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardContent className="p-5 grid gap-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Logo URL</Label>
              <Input value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} />
            </div>
            <div>
              <Label>Cover URL</Label>
              <Input value={form.coverImageUrl} onChange={(e) => set('coverImageUrl', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact email</Label>
              <Input value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
            </div>
            <div>
              <Label>Contact phone</Label>
              <Input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
            </div>
          </div>
          <div className="pt-2">
            <Button onClick={save} disabled={saving}><Save className="size-4" /> {saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[240px]">
            <div className="font-semibold text-destructive">Deactivate brand</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sets the brand to SUSPENDED. Restaurants stay assigned (you can unassign or reactivate later).
              Public /brand/{brand.slug} URL stops responding.
            </p>
          </div>
          <Button
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/5"
            onClick={deactivate}
            disabled={deactivating || brand.status === 'SUSPENDED'}
          >
            <Trash2 className="size-4" /> {deactivating ? 'Working…' : brand.status === 'SUSPENDED' ? 'Already suspended' : 'Deactivate'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
