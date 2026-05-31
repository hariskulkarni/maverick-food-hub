'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Layers, Plus, Search, X, ArrowUpRight } from 'lucide-react';
import { money } from '@/lib/utils';

interface BrandRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  status: string;
  createdAt: string;
  cuisineCount: number;
  lifetimeRevenue: number;
}

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'PENDING', 'SUSPENDED'] as const;

export function BrandsClient({ initial }: { initial: BrandRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return initial.filter((b) => {
      if (status !== 'ALL' && b.status !== status) return false;
      if (!needle) return true;
      return (
        b.name.toLowerCase().includes(needle) ||
        b.slug.toLowerCase().includes(needle) ||
        (b.tagline ?? '').toLowerCase().includes(needle)
      );
    });
  }, [initial, q, status]);

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brands by name, slug, or tagline" className="pl-9" />
              {q && (
                <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Button onClick={() => setCreateOpen(true)} className="ml-auto"><Plus className="size-4" /> New brand</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  status === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'
                }`}
              >
                {s === 'ALL' ? 'All' : s}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        initial.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No umbrella brands yet"
            description="Create your first to group cuisines under a single hospitality client."
            action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> New brand</Button>}
          />
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">
            No brands match these filters.
          </div>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((b) => (
            <BrandRowCard key={b.id} brand={b} />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateBrandDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false);
            toast.success('Brand created');
            router.push(`/platform/brands/${id}`);
          }}
        />
      )}
    </>
  );
}

function BrandRowCard({ brand }: { brand: BrandRow }) {
  return (
    <Link href={`/platform/brands/${brand.id}`} className="block">
      <Card className="overflow-hidden card-lift hover:border-primary/40 transition-colors">
        <CardContent className="p-0">
          <div className="relative h-20 bg-muted">
            {brand.coverImageUrl
              ? <Image src={brand.coverImageUrl} alt="" fill sizes="600px" className="object-cover" />
              : <div className="absolute inset-0 bg-gradient-to-br from-primary/15 via-warning/10 to-success/10" />}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
            <div className="absolute top-3 right-3"><StatusBadge status={brand.status} /></div>
            {brand.logoUrl && (
              <div className="absolute -bottom-5 left-4 size-12 rounded-xl overflow-hidden border-2 border-card bg-card">
                <Image src={brand.logoUrl} alt="" fill sizes="48px" className="object-cover" />
              </div>
            )}
          </div>
          <div className={`p-4 ${brand.logoUrl ? 'pt-7' : ''} flex items-start justify-between gap-3`}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate">{brand.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">/{brand.slug}</div>
              {brand.tagline && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{brand.tagline}</p>}
              <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                <span className="rounded-md border bg-card px-2 py-1">
                  <span className="text-muted-foreground">Cuisines</span> <strong>{brand.cuisineCount}</strong>
                </span>
                <span className="rounded-md border bg-card px-2 py-1">
                  <span className="text-muted-foreground">Lifetime</span> <strong>{money(brand.lifetimeRevenue)}</strong>
                </span>
              </div>
            </div>
            <ArrowUpRight className="size-4 text-muted-foreground shrink-0 mt-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const v: 'success' | 'warning' | 'destructive' | 'muted' =
    status === 'ACTIVE' ? 'success' :
    status === 'PENDING' ? 'warning' :
    status === 'SUSPENDED' ? 'destructive' : 'muted';
  return <Badge variant={v} className="text-[10px]">{status}</Badge>;
}

// ─── Create dialog ──────────────────────────────────────────────────────────
function CreateBrandDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', slug: '', tagline: '', description: '',
    logoUrl: '', coverImageUrl: '', contactEmail: '', contactPhone: ''
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (form.name.trim().length < 2) return toast.error('Name is required (≥ 2 chars).');
    setSaving(true);
    try {
      const payload: any = { name: form.name.trim() };
      if (form.slug.trim())         payload.slug          = form.slug.trim();
      if (form.tagline.trim())      payload.tagline       = form.tagline.trim();
      if (form.description.trim())  payload.description   = form.description.trim();
      if (form.logoUrl.trim())      payload.logoUrl       = form.logoUrl.trim();
      if (form.coverImageUrl.trim())payload.coverImageUrl = form.coverImageUrl.trim();
      if (form.contactEmail.trim()) payload.contactEmail  = form.contactEmail.trim();
      if (form.contactPhone.trim()) payload.contactPhone  = form.contactPhone.trim();

      const r = await fetch('/api/platform/brands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error(await r.text());
      const created = await r.json();
      onCreated(created.id);
    } catch (e) {
      toast.error('Failed to create brand: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New umbrella brand</DialogTitle>
          <DialogDescription>Brands group cuisines under one hospitality client.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Olive Group" />
          </div>
          <div>
            <Label>Slug <span className="text-muted-foreground text-xs">(optional — derived from name)</span></Label>
            <Input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="olive-group" />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Five cuisines. One love." />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Logo URL</Label>
              <Input value={form.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label>Cover image URL</Label>
              <Input value={form.coverImageUrl} onChange={(e) => set('coverImageUrl', e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact email</Label>
              <Input value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="hello@olivegroup.in" />
            </div>
            <div>
              <Label>Contact phone</Label>
              <Input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+91…" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create brand'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
