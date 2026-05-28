'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Images, Sparkles, Grid3x3, Store, PanelBottom, Search,
  Plus, Trash2, ArrowUp, ArrowDown, Save, ExternalLink, Loader2, Pin,
} from 'lucide-react';
import { ImageUploader } from '@/components/image-uploader';
import type {
  DiscoveryConfig, CarouselSlide, CategoryTile, FooterColumn, NearbySort,
} from '@/server/discovery-cms';

type OfferOpt = { id: string; name: string; code: string | null; type: string };
type RestaurantOpt = { id: string; name: string; cuisine: string | null };

type TabKey = 'carousel' | 'topOffers' | 'whatsOnYourMind' | 'restaurantsNearby' | 'footer' | 'seo';
const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'carousel', label: 'Carousel', icon: Images },
  { key: 'topOffers', label: 'Top offers', icon: Sparkles },
  { key: 'whatsOnYourMind', label: "What's on your mind", icon: Grid3x3 },
  { key: 'restaurantsNearby', label: 'Restaurants near you', icon: Store },
  { key: 'footer', label: 'Footer', icon: PanelBottom },
  { key: 'seo', label: 'SEO', icon: Search },
];

export function DiscoveryCmsEditor({
  initial, offers, restaurants,
}: {
  initial: DiscoveryConfig;
  offers: OfferOpt[];
  restaurants: RestaurantOpt[];
}) {
  const [cfg, setCfg] = useState<DiscoveryConfig>(initial);
  const [tab, setTab] = useState<TabKey>('carousel');
  const [saving, setSaving] = useState(false);

  // Generic deep-section updater.
  const patch = <K extends keyof DiscoveryConfig>(section: K, value: Partial<DiscoveryConfig[K]>) =>
    setCfg((c) => ({ ...c, [section]: { ...c[section], ...value } }));

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/platform/discovery-cms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      if (data.config) setCfg(data.config);
      toast.success('Discovery page updated — live now.');
    } catch (e: any) {
      toast.error('Save failed', { description: String(e?.message || e).slice(0, 200) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Tab bar + sticky save */}
      <div className="flex flex-wrap items-center gap-2 sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mt-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:border-primary/40'
              }`}
            >
              <Icon className="size-3.5" /> {t.label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <a href="/restaurants" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ExternalLink className="size-3.5" /> Preview
          </a>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        {tab === 'carousel' && <CarouselTab cfg={cfg} patch={patch} setCfg={setCfg} />}
        {tab === 'topOffers' && <TopOffersTab cfg={cfg} patch={patch} offers={offers} />}
        {tab === 'whatsOnYourMind' && <WoymTab cfg={cfg} patch={patch} setCfg={setCfg} />}
        {tab === 'restaurantsNearby' && <NearbyTab cfg={cfg} patch={patch} restaurants={restaurants} />}
        {tab === 'footer' && <FooterTab cfg={cfg} patch={patch} />}
        {tab === 'seo' && <SeoTab cfg={cfg} patch={patch} />}
      </div>
    </div>
  );
}

// ─────────────────────────── shared field helpers ───────────────────────────
type PatchFn = <K extends keyof DiscoveryConfig>(section: K, value: Partial<DiscoveryConfig[K]>) => void;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground mb-1">{hint}</span>}
      <div className={hint ? '' : 'mt-1'}>{children}</div>
    </label>
  );
}

function Text({ value, onChange, placeholder, max }: { value: string; onChange: (v: string) => void; placeholder?: string; max?: number }) {
  return (
    <input
      type="text"
      value={value}
      maxLength={max}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:border-primary"
    />
  );
}

function Area({ value, onChange, placeholder, rows = 3, max }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; max?: number }) {
  return (
    <textarea
      value={value}
      rows={rows}
      maxLength={max}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${checked ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground'}`}
    >
      <span className={`size-2 rounded-full ${checked ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
      {label}: {checked ? 'On' : 'Off'}
    </button>
  );
}

function MoveControls({ i, len, onMove, onRemove }: { i: number; len: number; onMove: (from: number, to: number) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" disabled={i === 0} onClick={() => onMove(i, i - 1)} className="grid size-7 place-items-center rounded border disabled:opacity-30" aria-label="Move up"><ArrowUp className="size-3.5" /></button>
      <button type="button" disabled={i === len - 1} onClick={() => onMove(i, i + 1)} className="grid size-7 place-items-center rounded border disabled:opacity-30" aria-label="Move down"><ArrowDown className="size-3.5" /></button>
      <button type="button" onClick={onRemove} className="grid size-7 place-items-center rounded border text-destructive hover:bg-destructive/10" aria-label="Remove"><Trash2 className="size-3.5" /></button>
    </div>
  );
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ─────────────────────────────── Carousel tab ───────────────────────────────
function CarouselTab({ cfg, patch, setCfg }: { cfg: DiscoveryConfig; patch: PatchFn; setCfg: React.Dispatch<React.SetStateAction<DiscoveryConfig>> }) {
  const slides = cfg.carousel.slides;
  const setSlides = (next: CarouselSlide[]) => patch('carousel', { slides: next });
  const update = (i: number, v: Partial<CarouselSlide>) => setSlides(slides.map((s, idx) => (idx === i ? { ...s, ...v } : s)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={cfg.carousel.enabled} onChange={(v) => patch('carousel', { enabled: v })} label="Carousel" />
        <Field label="Autoplay (ms, 0 = off)">
          <input
            type="number" min={0} max={30000} step={500}
            value={cfg.carousel.autoplayMs}
            onChange={(e) => patch('carousel', { autoplayMs: Number(e.target.value) || 0 })}
            className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
          />
        </Field>
      </div>

      <div className="space-y-3">
        {slides.map((s, i) => (
          <div key={i} className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Slide {i + 1}</span>
              <div className="flex items-center gap-2">
                <Toggle checked={s.enabled} onChange={(v) => update(i, { enabled: v })} label="Visible" />
                <MoveControls i={i} len={slides.length} onMove={(f, t) => setSlides(arrayMove(slides, f, t))} onRemove={() => setSlides(slides.filter((_, idx) => idx !== i))} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[200px_1fr]">
              <ImageUploader value={s.src} onChange={(url) => update(i, { src: url || '' })} folder="banners" aspect="wide" label="Banner image (2:1)" recommended="2600×1300 px (2:1, landscape) · JPG/PNG/WebP" />
              <div className="space-y-3">
                <Field label="Alt text" hint="Describes the image for accessibility + SEO."><Text value={s.alt} onChange={(v) => update(i, { alt: v })} max={240} placeholder="Wok & Sizzler — wok-tossed happiness…" /></Field>
                <Field label="Link (optional)" hint="Where the slide goes when tapped, e.g. /r/wok-sizzler"><Text value={s.href} onChange={(v) => update(i, { href: v })} placeholder="/r/some-restaurant" /></Field>
                <Field label="Fallback gradient" hint="Tailwind from/via/to classes shown while the image loads or if it's missing."><Text value={s.fallback} onChange={(v) => update(i, { fallback: v })} placeholder="from-[#ff5a2c] via-[#ff3b30] to-[#e0286f]" /></Field>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCfg((c) => ({ ...c, carousel: { ...c.carousel, slides: [...c.carousel.slides, { src: '', alt: '', href: '', fallback: 'from-[#ff5a2c] via-[#ff3b30] to-[#e0286f]', enabled: true }] } }))}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm hover:border-primary"
      >
        <Plus className="size-4" /> Add slide
      </button>
    </div>
  );
}

// ────────────────────────────── Top offers tab ──────────────────────────────
function TopOffersTab({ cfg, patch, offers }: { cfg: DiscoveryConfig; patch: PatchFn; offers: OfferOpt[] }) {
  const pinned = cfg.topOffers.pinnedOfferIds;
  const setPinned = (next: string[]) => patch('topOffers', { pinnedOfferIds: next });
  const byId = new Map(offers.map((o) => [o.id, o]));
  const unpinned = offers.filter((o) => !pinned.includes(o.id));

  return (
    <div className="space-y-4">
      <Toggle checked={cfg.topOffers.enabled} onChange={(v) => patch('topOffers', { enabled: v })} label="Top offers section" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Heading"><Text value={cfg.topOffers.heading} onChange={(v) => patch('topOffers', { heading: v })} max={80} /></Field>
        <Field label="Max tiles shown">
          <input type="number" min={1} max={30} value={cfg.topOffers.limit} onChange={(e) => patch('topOffers', { limit: Number(e.target.value) || 1 })} className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm" />
        </Field>
      </div>
      <Field label="Subheading (optional)"><Text value={cfg.topOffers.subheading} onChange={(v) => patch('topOffers', { subheading: v })} max={200} /></Field>

      <div>
        <p className="text-sm font-medium mb-1">Pinned offers</p>
        <p className="text-xs text-muted-foreground mb-2">Pinned offers always appear first (in this order); the rest auto-fill by priority. Only active offers are listed.</p>
        {pinned.length === 0 && <p className="text-sm text-muted-foreground">No offers pinned — the strip is fully automatic.</p>}
        <div className="space-y-2">
          {pinned.map((id, i) => {
            const o = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Pin className="size-3.5 text-primary" />
                <span className="flex-1 truncate">{o ? o.name : <span className="text-muted-foreground">Offer {id} (inactive / removed)</span>}{o?.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{o.code}</span> : null}</span>
                <MoveControls i={i} len={pinned.length} onMove={(f, t) => setPinned(arrayMove(pinned, f, t))} onRemove={() => setPinned(pinned.filter((x) => x !== id))} />
              </div>
            );
          })}
        </div>
        {unpinned.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { setPinned([...pinned, e.target.value]); e.target.value = ''; } }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">+ Pin an offer…</option>
              {unpinned.map((o) => <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ''}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────── What's on your mind tab ──────────────────────────
function WoymTab({ cfg, patch, setCfg }: { cfg: DiscoveryConfig; patch: PatchFn; setCfg: React.Dispatch<React.SetStateAction<DiscoveryConfig>> }) {
  const tiles = cfg.whatsOnYourMind.tiles;
  const setTiles = (next: CategoryTile[]) => patch('whatsOnYourMind', { tiles: next });
  const update = (i: number, v: Partial<CategoryTile>) => setTiles(tiles.map((t, idx) => (idx === i ? { ...t, ...v } : t)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={cfg.whatsOnYourMind.enabled} onChange={(v) => patch('whatsOnYourMind', { enabled: v })} label="Section" />
        <Field label="Heading"><Text value={cfg.whatsOnYourMind.heading} onChange={(v) => patch('whatsOnYourMind', { heading: v })} max={80} /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t, i) => (
          <div key={i} className="rounded-lg border p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">{t.label || `Tile ${i + 1}`}</span>
              <div className="flex items-center gap-2">
                <Toggle checked={t.enabled} onChange={(v) => update(i, { enabled: v })} label="Visible" />
                <MoveControls i={i} len={tiles.length} onMove={(f, tt) => setTiles(arrayMove(tiles, f, tt))} onRemove={() => setTiles(tiles.filter((_, idx) => idx !== i))} />
              </div>
            </div>
            <div className="grid gap-3 grid-cols-[96px_1fr]">
              <ImageUploader value={t.image} onChange={(url) => update(i, { image: url || '' })} folder="discovery" aspect="square" recommended="600×600 px (square) · JPG/PNG/WebP" />
              <div className="space-y-2">
                <Field label="Label"><Text value={t.label} onChange={(v) => update(i, { label: v })} max={60} /></Field>
                <Field label="Category slug" hint="Links to /category/<slug>"><Text value={t.slug} onChange={(v) => update(i, { slug: v })} max={64} placeholder="biryani" /></Field>
                <Field label="Alt text"><Text value={t.alt} onChange={(v) => update(i, { alt: v })} max={160} /></Field>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCfg((c) => ({ ...c, whatsOnYourMind: { ...c.whatsOnYourMind, tiles: [...c.whatsOnYourMind.tiles, { slug: '', label: '', image: '', alt: '', enabled: true }] } }))}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm hover:border-primary"
      >
        <Plus className="size-4" /> Add tile
      </button>
    </div>
  );
}

// ───────────────────────── Restaurants near you tab ─────────────────────────
function NearbyTab({ cfg, patch, restaurants }: { cfg: DiscoveryConfig; patch: PatchFn; restaurants: RestaurantOpt[] }) {
  const featured = cfg.restaurantsNearby.featuredRestaurantIds;
  const setFeatured = (next: string[]) => patch('restaurantsNearby', { featuredRestaurantIds: next });
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  const unfeatured = restaurants.filter((r) => !featured.includes(r.id));

  return (
    <div className="space-y-4">
      <Toggle checked={cfg.restaurantsNearby.enabled} onChange={(v) => patch('restaurantsNearby', { enabled: v })} label="Section header" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Eyebrow" hint="Small uppercase label above the heading."><Text value={cfg.restaurantsNearby.eyebrow} onChange={(v) => patch('restaurantsNearby', { eyebrow: v })} max={80} /></Field>
        <Field label="Default sort">
          <select value={cfg.restaurantsNearby.defaultSort} onChange={(e) => patch('restaurantsNearby', { defaultSort: e.target.value as NearbySort })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="newest">Nearest / newest</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </Field>
      </div>
      <Field label="Heading"><Text value={cfg.restaurantsNearby.heading} onChange={(v) => patch('restaurantsNearby', { heading: v })} max={120} /></Field>
      <Field label="Subheading (optional)" hint="Leave blank to keep the automatic 'Sorted by…' line."><Text value={cfg.restaurantsNearby.subheading} onChange={(v) => patch('restaurantsNearby', { subheading: v })} max={240} /></Field>

      <div>
        <p className="text-sm font-medium mb-1">Featured restaurants</p>
        <p className="text-xs text-muted-foreground mb-2">Featured restaurants float to the top of the grid (in this order) when they match the visitor's location/filters.</p>
        {featured.length === 0 && <p className="text-sm text-muted-foreground">None featured — the grid uses the default sort.</p>}
        <div className="space-y-2">
          {featured.map((id, i) => {
            const r = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Store className="size-3.5 text-primary" />
                <span className="flex-1 truncate">{r ? r.name : <span className="text-muted-foreground">Restaurant {id} (inactive)</span>}{r?.cuisine ? <span className="ml-2 text-xs text-muted-foreground">{r.cuisine}</span> : null}</span>
                <MoveControls i={i} len={featured.length} onMove={(f, t) => setFeatured(arrayMove(featured, f, t))} onRemove={() => setFeatured(featured.filter((x) => x !== id))} />
              </div>
            );
          })}
        </div>
        {unfeatured.length > 0 && (
          <div className="mt-3">
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { setFeatured([...featured, e.target.value]); e.target.value = ''; } }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">+ Feature a restaurant…</option>
              {unfeatured.map((r) => <option key={r.id} value={r.id}>{r.name}{r.cuisine ? ` — ${r.cuisine}` : ''}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────── Footer tab ───────────────────────────────
function FooterTab({ cfg, patch }: { cfg: DiscoveryConfig; patch: PatchFn }) {
  const columns = cfg.footer.columns;
  const setColumns = (next: FooterColumn[]) => patch('footer', { columns: next });
  const updateCol = (i: number, v: Partial<FooterColumn>) => setColumns(columns.map((c, idx) => (idx === i ? { ...c, ...v } : c)));
  const social = cfg.footer.social;

  return (
    <div className="space-y-5">
      <Toggle checked={cfg.footer.enabled} onChange={(v) => patch('footer', { enabled: v })} label="Footer (desktop)" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tagline" hint="Blank ⇒ uses the brand tagline."><Text value={cfg.footer.tagline} onChange={(v) => patch('footer', { tagline: v })} max={160} /></Field>
        <Field label="Blurb"><Area value={cfg.footer.blurb} onChange={(v) => patch('footer', { blurb: v })} max={600} rows={2} /></Field>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Social links (full URLs; blank = hidden)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['twitter', 'instagram', 'facebook', 'linkedin', 'youtube'] as const).map((k) => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
              <Text value={social[k]} onChange={(v) => patch('footer', { social: { ...social, [k]: v } })} placeholder={`https://${k}.com/flavrly`} />
            </Field>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Link columns</p>
          <button type="button" onClick={() => setColumns([...columns, { title: 'New column', links: [] }])} className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs hover:border-primary"><Plus className="size-3.5" /> Add column</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {columns.map((col, ci) => (
            <div key={ci} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 mb-2">
                <Text value={col.title} onChange={(v) => updateCol(ci, { title: v })} max={60} />
                <MoveControls i={ci} len={columns.length} onMove={(f, t) => setColumns(arrayMove(columns, f, t))} onRemove={() => setColumns(columns.filter((_, idx) => idx !== ci))} />
              </div>
              <div className="space-y-2">
                {col.links.map((l, li) => (
                  <div key={li} className="flex items-center gap-1.5">
                    <input value={l.label} placeholder="Label" onChange={(e) => updateCol(ci, { links: col.links.map((x, idx) => idx === li ? { ...x, label: e.target.value } : x) })} className="h-8 w-1/3 rounded-md border border-input bg-background px-2 text-xs" />
                    <input value={l.href} placeholder="/path or https://…" onChange={(e) => updateCol(ci, { links: col.links.map((x, idx) => idx === li ? { ...x, href: e.target.value } : x) })} className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" />
                    <button type="button" onClick={() => updateCol(ci, { links: col.links.filter((_, idx) => idx !== li) })} className="grid size-7 place-items-center rounded border text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => updateCol(ci, { links: [...col.links, { label: '', href: '' }] })} className="inline-flex items-center gap-1 text-xs text-primary"><Plus className="size-3.5" /> Add link</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Legal line (left)" hint="Blank ⇒ © YEAR Brand. All rights reserved."><Text value={cfg.footer.legalLeft} onChange={(v) => patch('footer', { legalLeft: v })} max={200} /></Field>
        <Field label="Legal line (right)"><Text value={cfg.footer.legalRight} onChange={(v) => patch('footer', { legalRight: v })} max={200} /></Field>
      </div>
    </div>
  );
}

// ──────────────────────────────── SEO tab ────────────────────────────────
function SeoTab({ cfg, patch }: { cfg: DiscoveryConfig; patch: PatchFn }) {
  return (
    <div className="space-y-4 max-w-2xl">
      <Field label="Meta title" hint="Blank ⇒ 'All restaurants'. Shown in the browser tab + search results."><Text value={cfg.seo.metaTitle} onChange={(v) => patch('seo', { metaTitle: v })} max={120} /></Field>
      <Field label="Meta description" hint="Up to ~320 chars. Summarises the page for search engines."><Area value={cfg.seo.metaDescription} onChange={(v) => patch('seo', { metaDescription: v })} max={320} rows={3} /></Field>
      <Field label="Keywords" hint="Comma-separated."><Text value={cfg.seo.keywords} onChange={(v) => patch('seo', { keywords: v })} max={320} placeholder="food delivery, restaurants near me, biryani…" /></Field>
      <Field label="Social share image (OG image)" hint="Shown when the page is shared on WhatsApp / social.">
        <ImageUploader value={cfg.seo.ogImage} onChange={(url) => patch('seo', { ogImage: url || '' })} folder="seo" aspect="wide" recommended="1200×630 px (1.91:1) · Open Graph standard" />
      </Field>
    </div>
  );
}
