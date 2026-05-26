'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Image as ImageIcon, Images, Plus, Trash2, ArrowUp, ArrowDown, Save, ExternalLink, Eye, EyeOff, ChevronDown, ChevronRight, Star, Loader2 } from 'lucide-react';
import type { StorefrontConfig, HeroSlide, HeroTransition, MenuLayout } from '@/server/storefront-cms';

type Cat = { id: string; name: string; sortOrder: number; isActive: boolean; itemCount: number };
type Item = { id: string; name: string; sortOrder: number; isAvailable: boolean; isFeatured: boolean };

export function StorefrontEditor({ initialConfig, categories, slug, coverImageUrl }: {
  initialConfig: StorefrontConfig; categories: Cat[]; slug: string; coverImageUrl: string | null;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<StorefrontConfig>(initialConfig);
  const [cats, setCats] = useState<Cat[]>(categories);
  const [savingCfg, setSavingCfg] = useState(false);
  const [savingCats, setSavingCats] = useState(false);
  // Per-item editing (lazy-loaded per category)
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [itemsByCat, setItemsByCat] = useState<Record<string, Item[]>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingItems, setSavingItems] = useState(false);

  async function toggleCatItems(catId: string) {
    if (openCat === catId) { setOpenCat(null); return; }
    setOpenCat(catId);
    if (!itemsByCat[catId]) {
      setLoadingItems(true);
      try {
        const r = await fetch(`/api/admin/storefront/items?categoryId=${catId}`);
        const j = await r.json();
        if (j.ok) setItemsByCat((m) => ({ ...m, [catId]: j.items as Item[] }));
        else toast.error(j.message || 'Could not load items');
      } finally { setLoadingItems(false); }
    }
  }
  function moveItem(catId: string, i: number, dir: -1 | 1) {
    setItemsByCat((m) => {
      const arr = [...(m[catId] ?? [])]; const j = i + dir; if (j < 0 || j >= arr.length) return m;
      [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...m, [catId]: arr };
    });
  }
  function toggleFeatured(catId: string, i: number) {
    setItemsByCat((m) => ({ ...m, [catId]: (m[catId] ?? []).map((it, idx) => (idx === i ? { ...it, isFeatured: !it.isFeatured } : it)) }));
  }
  async function saveItems(catId: string) {
    setSavingItems(true);
    try {
      const items = (itemsByCat[catId] ?? []).map((it, idx) => ({ id: it.id, sortOrder: idx, isFeatured: it.isFeatured }));
      const r = await fetch('/api/admin/storefront/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      if (!r.ok) return toast.error(`Save failed: ${await r.text()}`);
      toast.success('Item order & featured saved'); router.refresh();
    } finally { setSavingItems(false); }
  }

  const setHero = (patch: Partial<StorefrontConfig['hero']>) => setCfg((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  const setBrand = (patch: Partial<StorefrontConfig['branding']>) => setCfg((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  const setLayout = (patch: Partial<StorefrontConfig['layout']>) => setCfg((c) => ({ ...c, layout: { ...c.layout, ...patch } }));
  const setSlide = (i: number, patch: Partial<HeroSlide>) =>
    setHero({ slides: cfg.hero.slides.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const addSlide = () => setHero({ slides: [...cfg.hero.slides, { src: '' }] });
  const removeSlide = (i: number) => setHero({ slides: cfg.hero.slides.filter((_, idx) => idx !== i) });
  const moveSlide = (i: number, dir: -1 | 1) => {
    const arr = [...cfg.hero.slides]; const j = i + dir; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; setHero({ slides: arr });
  };

  async function saveConfig() {
    setSavingCfg(true);
    try {
      const r = await fetch('/api/admin/storefront', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) });
      if (!r.ok) return toast.error(`Save failed: ${await r.text()}`);
      toast.success('Storefront design saved — live now'); router.refresh();
    } finally { setSavingCfg(false); }
  }

  function moveCat(i: number, dir: -1 | 1) {
    const arr = [...cats]; const j = i + dir; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]]; setCats(arr.map((c, idx) => ({ ...c, sortOrder: idx })));
  }
  function toggleCat(i: number) { setCats(cats.map((c, idx) => (idx === i ? { ...c, isActive: !c.isActive } : c))); }
  async function saveCats() {
    setSavingCats(true);
    try {
      const items = cats.map((c, idx) => ({ id: c.id, sortOrder: idx, isActive: c.isActive }));
      const r = await fetch('/api/admin/storefront/categories', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      if (!r.ok) return toast.error(`Save failed: ${await r.text()}`);
      toast.success('Menu order & visibility saved'); router.refresh();
    } finally { setSavingCats(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <a href={`/r/${slug}`} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
          <ExternalLink className="size-4" /> Preview live storefront
        </a>
      </div>

      {/* HERO */}
      <Section title="Hero & Carousel" subtitle="The big banner at the top of your page.">
        <div className="flex gap-2">
          <Choice active={cfg.hero.type === 'cover'} onClick={() => setHero({ type: 'cover' })} icon={ImageIcon} label="Single cover image" />
          <Choice active={cfg.hero.type === 'carousel'} onClick={() => setHero({ type: 'carousel' })} icon={Images} label="Carousel (multiple slides)" />
        </div>

        {cfg.hero.type === 'cover' && (
          <p className="text-xs text-muted-foreground">Uses your restaurant cover image{coverImageUrl ? '' : ' (none set — add one under Settings → Branding)'}.</p>
        )}

        {cfg.hero.type === 'carousel' && (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Transition">
                <select value={cfg.hero.transition} onChange={(e) => setHero({ transition: e.target.value as HeroTransition })}
                  className="h-9 rounded-md border bg-background px-2 text-sm w-[140px]">
                  <option value="slide">Slide</option><option value="fade">Fade</option><option value="zoom">Zoom</option>
                </select>
              </Field>
              <Field label="Autoplay (seconds, 0 = off)">
                <Input type="number" min={0} max={30} value={Math.round(cfg.hero.autoplayMs / 1000)}
                  onChange={(e) => setHero({ autoplayMs: (Number(e.target.value) || 0) * 1000 })} className="h-9 w-[120px]" />
              </Field>
            </div>

            <div className="space-y-3">
              {cfg.hero.slides.map((s, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Slide {i + 1}</span>
                    <div className="ml-auto flex gap-1">
                      <IconBtn onClick={() => moveSlide(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></IconBtn>
                      <IconBtn onClick={() => moveSlide(i, 1)} disabled={i === cfg.hero.slides.length - 1}><ArrowDown className="size-3.5" /></IconBtn>
                      <IconBtn onClick={() => removeSlide(i)} danger><Trash2 className="size-3.5" /></IconBtn>
                    </div>
                  </div>
                  <Input placeholder="Image URL (e.g. /banners/slide1.jpg or https://…)" value={s.src} onChange={(e) => setSlide(i, { src: e.target.value })} className="h-9" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Headline (optional)" value={s.headline ?? ''} onChange={(e) => setSlide(i, { headline: e.target.value })} className="h-9" />
                    <Input placeholder="Subtext (optional)" value={s.subtext ?? ''} onChange={(e) => setSlide(i, { subtext: e.target.value })} className="h-9" />
                    <Input placeholder="Button label (optional)" value={s.ctaLabel ?? ''} onChange={(e) => setSlide(i, { ctaLabel: e.target.value })} className="h-9" />
                    <Input placeholder="Button link (optional)" value={s.ctaHref ?? ''} onChange={(e) => setSlide(i, { ctaHref: e.target.value })} className="h-9" />
                  </div>
                  {s.src && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={s.src} alt={`Slide ${i + 1}`} className="h-24 w-full object-cover rounded-md border" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
                  )}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addSlide}><Plus className="size-4" /> Add slide</Button>
              <p className="text-[11px] text-muted-foreground">Tip: upload images under Menu → image upload or drop files into <span className="font-mono">public/banners/</span>, then paste the path here.</p>
            </div>
          </>
        )}
      </Section>

      {/* BRANDING */}
      <Section title="Branding" subtitle="Tagline & accent shown across your page.">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Tagline">
            <Input value={cfg.branding.tagline} onChange={(e) => setBrand({ tagline: e.target.value })} placeholder="e.g. Andhra's smokiest barbeque" className="h-9 w-[320px]" />
          </Field>
          <Field label="Accent colour">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.branding.accentColor} onChange={(e) => setBrand({ accentColor: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
              <Input value={cfg.branding.accentColor} onChange={(e) => setBrand({ accentColor: e.target.value })} className="h-9 w-[110px] font-mono" />
            </div>
          </Field>
        </div>
      </Section>

      {/* LAYOUT */}
      <Section title="Layout & Sections" subtitle="Toggle what customers see and how the menu is laid out.">
        <div className="grid sm:grid-cols-2 gap-2">
          <Toggle on={cfg.layout.showSearch} onClick={() => setLayout({ showSearch: !cfg.layout.showSearch })} label="Search bar" />
          <Toggle on={cfg.layout.showFilters} onClick={() => setLayout({ showFilters: !cfg.layout.showFilters })} label="Filter chips (veg, etc.)" />
          <Toggle on={cfg.layout.showOffersStrip} onClick={() => setLayout({ showOffersStrip: !cfg.layout.showOffersStrip })} label="Offers strip" />
          <Toggle on={cfg.layout.showTopSellers} onClick={() => setLayout({ showTopSellers: !cfg.layout.showTopSellers })} label="Top sellers" />
        </div>
        <Field label="Menu layout">
          <div className="flex gap-2">
            {(['list', 'grid'] as MenuLayout[]).map((m) => (
              <Choice key={m} active={cfg.layout.menuLayout === m} onClick={() => setLayout({ menuLayout: m })} label={m === 'list' ? 'List' : 'Grid'} />
            ))}
          </div>
        </Field>
      </Section>

      <div className="sticky bottom-4 z-10">
        <Button onClick={saveConfig} disabled={savingCfg} className="shadow-lg"><Save className="size-4" /> {savingCfg ? 'Saving…' : 'Save storefront design'}</Button>
      </div>

      {/* MENU ORDER */}
      <Section title="Menu categories — order & visibility" subtitle="Reorder how categories appear, and show/hide them on the storefront.">
        <div className="divide-y border rounded-lg overflow-hidden">
          {cats.map((c, i) => (
            <div key={c.id} className={c.isActive ? '' : 'bg-muted/40'}>
              <div className={`flex items-center gap-3 px-3 py-2.5 ${c.isActive ? '' : 'opacity-70'}`}>
                <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                <button type="button" onClick={() => toggleCatItems(c.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                  {openCat === c.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground">{c.itemCount} item{c.itemCount === 1 ? '' : 's'} · tap arrow to order items</div>
                </div>
                <IconBtn onClick={() => toggleCat(i)}>{c.isActive ? <Eye className="size-4 text-success" /> : <EyeOff className="size-4 text-muted-foreground" />}</IconBtn>
                <IconBtn onClick={() => moveCat(i, -1)} disabled={i === 0}><ArrowUp className="size-4" /></IconBtn>
                <IconBtn onClick={() => moveCat(i, 1)} disabled={i === cats.length - 1}><ArrowDown className="size-4" /></IconBtn>
              </div>
              {openCat === c.id && (
                <div className="px-3 pb-3 pl-12 space-y-1.5 bg-muted/20">
                  {loadingItems && !itemsByCat[c.id] && <div className="py-3 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Loading items…</div>}
                  {(itemsByCat[c.id] ?? []).map((it, idx, arr) => (
                    <div key={it.id} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
                      <span className="text-[10px] text-muted-foreground w-4 text-right">{idx + 1}</span>
                      <span className={`flex-1 text-sm truncate ${it.isAvailable ? '' : 'text-muted-foreground line-through'}`}>{it.name}</span>
                      <IconBtn onClick={() => toggleFeatured(c.id, idx)}><Star className={`size-3.5 ${it.isFeatured ? 'fill-warning text-warning' : 'text-muted-foreground'}`} /></IconBtn>
                      <IconBtn onClick={() => moveItem(c.id, idx, -1)} disabled={idx === 0}><ArrowUp className="size-3.5" /></IconBtn>
                      <IconBtn onClick={() => moveItem(c.id, idx, 1)} disabled={idx === arr.length - 1}><ArrowDown className="size-3.5" /></IconBtn>
                    </div>
                  ))}
                  {itemsByCat[c.id] && itemsByCat[c.id].length === 0 && <div className="py-2 text-xs text-muted-foreground">No items in this category.</div>}
                  {itemsByCat[c.id] && itemsByCat[c.id].length > 0 && (
                    <Button size="sm" variant="outline" disabled={savingItems} onClick={() => saveItems(c.id)} className="mt-1">
                      {savingItems ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save items (★ = featured)
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
          {cats.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No categories yet — add them under Menu.</div>}
        </div>
        <Button onClick={saveCats} disabled={savingCats} variant="outline"><Save className="size-4" /> {savingCats ? 'Saving…' : 'Save menu order'}</Button>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </CardContent></Card>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>{children}</div>;
}
function Choice({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon?: any; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${active ? 'border-primary bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-muted-foreground'}`}>
      {Icon && <Icon className="size-4" />} {label}
    </button>
  );
}
function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm hover:bg-accent/50">
      <span>{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}
function IconBtn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`grid size-7 place-items-center rounded-md border transition-colors disabled:opacity-30 ${danger ? 'text-destructive border-destructive/30 hover:bg-destructive/10' : 'hover:bg-accent'}`}>
      {children}
    </button>
  );
}
