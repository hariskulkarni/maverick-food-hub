'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  Images, Sparkles, Grid3x3, Store, PanelBottom, Search,
  Plus, Trash2, ArrowUp, ArrowDown, Save, ExternalLink, Loader2, Pin,
} from 'lucide-react';
import { ImageUploader } from '@/components/image-uploader';
import type {
  DiscoveryConfig, CarouselSlide, CategoryTile, FooterColumn, NearbySort, SlideCtaStyle,
  SlideObjectFit, SlideOverlayPosition, CarouselTransition, CarouselAspectRatio, SlideMediaType,
} from '@/server/discovery-cms';
import type { HeroWidth, HeroHeight } from '@/server/storefront-cms';
import {
  HERO_WIDTHS, HERO_HEIGHTS,
  HERO_WIDTH_LABELS, HERO_HEIGHT_LABELS,
  HERO_WIDTH_HINTS, HERO_HEIGHT_HINTS,
} from '@/server/storefront-cms';

type OfferLifecycle = 'active' | 'scheduled' | 'paused' | 'expired';
type OfferOpt = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  /** Computed at fetch time so the picker can group offers + show why a given
   *  offer isn't currently rendering on the storefront strip. */
  lifecycle?: OfferLifecycle;
  /** Human label: 'Platform-wide' or the restaurant name. Helps super-admin
   *  tell apart same-named promos belonging to different outlets. */
  scope?: string;
};
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
  // Snapshot of the last-persisted tiles, used to detect slug renames on save
  // (so we can warn that the old /category URL will be retired + redirected).
  const savedTiles = useRef(initial.whatsOnYourMind.tiles);
  const [tab, setTab] = useState<TabKey>('carousel');
  const [saving, setSaving] = useState(false);

  // Generic deep-section updater.
  const patch = <K extends keyof DiscoveryConfig>(section: K, value: Partial<DiscoveryConfig[K]>) =>
    setCfg((c) => ({ ...c, [section]: { ...c[section], ...value } }));

  async function save() {
    // Warn when a tile's slug changed — the old category page is retired and
    // visitors are auto-redirected to the new slug.
    const norm = (x: string) => x.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const renames: { from: string; to: string }[] = [];
    for (const oldT of savedTiles.current) {
      const cur = cfg.whatsOnYourMind.tiles.find((t) => t.label.trim().toLowerCase() === oldT.label.trim().toLowerCase());
      if (cur && norm(oldT.slug) && norm(cur.slug) !== norm(oldT.slug)) {
        renames.push({ from: norm(oldT.slug), to: norm(cur.slug) });
      }
    }
    if (renames.length > 0) {
      const lines = renames.map((r) => `  \u2022 /category/${r.from}  \u2192  /category/${r.to}`).join('\n');
      const ok = window.confirm(
        `You changed ${renames.length === 1 ? 'a category slug' : `${renames.length} category slugs`}.\n\n` +
        `The old page${renames.length === 1 ? '' : 's'} will be retired and visitors auto-redirected to the new one:\n\n` +
        `${lines}\n\nApply these changes?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/platform/discovery-cms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg }),
      });
      if (!r.ok) {
        // The API returns `{ error, code }` for every non-2xx. The code lets
        // us surface a targeted message: re-login on auth/unauthenticated,
        // permission hint on auth/forbidden, generic message otherwise.
        let body: { error?: string; code?: string } = {};
        try { body = (await r.json()) ?? {}; } catch { /* fall through */ }
        if (body.code === 'auth/unauthenticated') {
          const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
          toast.error('Your session has expired.', {
            description: 'Sign in again to keep editing.',
            action: { label: 'Sign in', onClick: () => { window.location.href = `/login?next=${encodeURIComponent(next)}&mode=admin`; } },
          });
          return;
        }
        if (body.code === 'auth/forbidden') {
          toast.error('Permission denied', { description: body.error || 'This action requires platform super-admin access.' });
          return;
        }
        toast.error('Save failed', { description: (body.error || `HTTP ${r.status}`).slice(0, 240) });
        return;
      }
      const data = await r.json();
      if (data.config) setCfg(data.config);
      savedTiles.current = data.config?.whatsOnYourMind?.tiles ?? cfg.whatsOnYourMind.tiles;
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

function MediaTypeTabs({ value, onChange }: { value: 'image' | 'video'; onChange: (v: 'image' | 'video') => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs font-medium">
      {(['image', 'video'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`rounded px-2.5 py-1 capitalize transition-colors ${value === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {k}
        </button>
      ))}
    </div>
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

      {/* ── Carousel-level presentation: transition + duration + aspect ratio ──
           Three RevSlider-inspired controls that affect every slide. Editors
           can pick the animation between slides ('slide' is the classic
           horizontal swipe; 'fade' / 'zoom' / 'kenBurns' stack slides and
           swap opacity), how long the animation takes, and the overall
           banner shape. Defaults preserve the old look exactly. */}
      <div className="rounded-lg border bg-card p-3 grid gap-3 md:grid-cols-3">
        <Field label="Transition" hint="How slides animate between each other.">
          <select
            value={cfg.carousel.transition}
            onChange={(e) => patch('carousel', { transition: e.target.value as CarouselTransition })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="slide">Slide (classic swipe)</option>
            <option value="fade">Fade</option>
            <option value="zoom">Zoom</option>
            <option value="kenBurns">Ken Burns (slow pan + zoom)</option>
          </select>
        </Field>
        <Field label="Transition duration (ms)" hint="200 fast · 2000 slow.">
          <input
            type="number" min={200} max={2000} step={50}
            value={cfg.carousel.transitionMs}
            onChange={(e) => patch('carousel', { transitionMs: Number(e.target.value) || 700 })}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </Field>
        <Field label="Banner shape (legacy)" hint="Kept for back-compat. The richer Carousel size panel below overrides this when set.">
          <select
            value={cfg.carousel.aspectRatio}
            onChange={(e) => patch('carousel', { aspectRatio: e.target.value as CarouselAspectRatio })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="2:1">2:1 (landscape, classic)</option>
            <option value="21:9">21:9 (ultrawide)</option>
            <option value="16:9">16:9 (widescreen)</option>
            <option value="1:1">1:1 (square)</option>
          </select>
        </Field>
      </div>

      {/* ── NEW: Carousel size panel (7 widths × 8 heights) ─────────────────
           Shared presets with the per-restaurant storefront hero so the look
           is consistent across both admin surfaces. The picked Height
           supersedes the legacy "Banner shape" field above. */}
      <CarouselSizePanel
        width={cfg.carousel.width}
        height={cfg.carousel.height}
        onWidth={(w) => patch('carousel', { width: w })}
        onHeight={(h) => patch('carousel', { height: h })}
      />

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
              <div className="space-y-2">
                <MediaTypeTabs value={(s.mediaType ?? 'image')} onChange={(mt) => update(i, { mediaType: mt })} />
                {(s.mediaType ?? 'image') === 'video' ? (
                  <>
                    <ImageUploader kind="video" value={s.videoSrc} onChange={(url) => update(i, { videoSrc: url || '' })} folder="banners" aspect="wide" label="Hero video (MP4/WebM)" recommended="≤ 50 MB · 1920×1080 · short, muted loop" />
                    <ImageUploader value={s.poster} onChange={(url) => update(i, { poster: url || '' })} folder="banners" aspect="wide" label="Poster image (shown before the video plays)" recommended="2600×1300 px (2:1)" />
                  </>
                ) : (
                  <ImageUploader value={s.src} onChange={(url) => update(i, { src: url || '' })} folder="banners" aspect="wide" label="Banner image (2:1)" recommended="2600×1300 px (2:1, landscape) · JPG/PNG/WebP" />
                )}
              </div>
              <div className="space-y-3">
                {(s.mediaType ?? 'image') === 'video' && (
                  <>
                    <Field label="…or paste a video URL" hint="Direct .mp4/.webm link, or a YouTube / Vimeo URL (auto-embedded as a muted, looping background).">
                      <Text value={s.videoSrc} onChange={(v) => update(i, { videoSrc: v })} placeholder="https://cdn…/hero.mp4  ·  https://youtu.be/…" />
                    </Field>
                    <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 px-3 py-2">
                      <Toggle checked={s.videoAutoplay ?? true} onChange={(v) => update(i, { videoAutoplay: v })} label="Autoplay" />
                      <Toggle checked={s.videoLoop ?? true} onChange={(v) => update(i, { videoLoop: v })} label="Loop" />
                      <Toggle checked={s.videoMuted ?? true} onChange={(v) => update(i, { videoMuted: v })} label="Muted" />
                    </div>
                  </>
                )}
                <Field label="Alt text" hint="Describes the slide for accessibility + SEO."><Text value={s.alt} onChange={(v) => update(i, { alt: v })} max={240} placeholder="Wok & Sizzler — wok-tossed happiness…" /></Field>
                <Field label={(s.mediaType ?? 'image') === 'video' ? 'Video click link (optional)' : 'Image click link (optional)'} hint="Where the WHOLE banner goes when tapped, e.g. /r/wok-sizzler"><Text value={s.href} onChange={(v) => update(i, { href: v })} placeholder="/r/some-restaurant" /></Field>
                <Field label="Fallback gradient" hint="Tailwind from/via/to classes shown while the media loads or if it's missing."><Text value={s.fallback} onChange={(v) => update(i, { fallback: v })} placeholder="from-[#ff5a2c] via-[#ff3b30] to-[#e0286f]" /></Field>
              </div>
            </div>

            {/* ── Image presentation (RevSlider-style) ──────────────────────
                 Per-slide fit, focal point, overlay placement, and scrim
                 darkness. Defaults preserve current rendering. */}
            <div className="mt-4 rounded-lg border bg-muted/30 p-3 grid gap-3 md:grid-cols-4">
              <Field label="Image fit" hint="How the image fills the banner box.">
                <select
                  value={s.objectFit}
                  onChange={(e) => update(i, { objectFit: e.target.value as SlideObjectFit })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="contain">Contain (whole image, may letterbox)</option>
                  <option value="cover">Cover (fill, may crop)</option>
                  <option value="fill">Fill (stretch to exact size)</option>
                  <option value="none">None (original size)</option>
                </select>
              </Field>
              <Field label="Focal point" hint="Where to anchor when cropping. e.g. 'center', 'top', '20% 80%'.">
                <input
                  type="text" value={s.focalPoint} maxLength={40}
                  onChange={(e) => update(i, { focalPoint: e.target.value })}
                  placeholder="center"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </Field>
              <Field label="Overlay placement" hint="Where the headline + CTA sit on the slide.">
                <select
                  value={s.overlayPosition}
                  onChange={(e) => update(i, { overlayPosition: e.target.value as SlideOverlayPosition })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="bottom-left">Bottom-left</option>
                  <option value="bottom-center">Bottom-center</option>
                  <option value="bottom-right">Bottom-right</option>
                  <option value="center">Center</option>
                  <option value="top-left">Top-left</option>
                  <option value="top-center">Top-center</option>
                  <option value="top-right">Top-right</option>
                </select>
              </Field>
              <Field label={`Scrim darkness (${s.overlayDarkness})`} hint="0 = no scrim, 100 = solid.">
                <input
                  type="range" min={0} max={100} step={5}
                  value={s.overlayDarkness}
                  onChange={(e) => update(i, { overlayDarkness: Number(e.target.value) || 0 })}
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </Field>
            </div>

            {/* ── Overlay headline + CTA button ─────────────────────────────
                 Every field is optional. If none are set, the slide renders as
                 an image-only banner like before. */}
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <Sparkles className="size-3.5" /> Overlay text + CTA button (optional)
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Eyebrow" hint="Small uppercase chip (e.g. NEW THIS WEEK).">
                  <Text value={s.eyebrow} onChange={(v) => update(i, { eyebrow: v })} max={60} placeholder="New this week" />
                </Field>
                <Field label="Headline" hint="Big bold line over the banner.">
                  <Text value={s.headline} onChange={(v) => update(i, { headline: v })} max={120} placeholder="Wok-tossed happiness" />
                </Field>
                <Field label="Subtext" hint="Soft supporting line.">
                  <Text value={s.subtext} onChange={(v) => update(i, { subtext: v })} max={240} placeholder="Andhra street favourites, fresh & fast." />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_140px]">
                <Field label="CTA button label" hint="Blank ⇒ no button shown.">
                  <Text value={s.ctaLabel} onChange={(v) => update(i, { ctaLabel: v })} max={40} placeholder="Order now" />
                </Field>
                <Field label="CTA button link" hint="Blank ⇒ falls back to the image-click link above.">
                  <Text value={s.ctaHref} onChange={(v) => update(i, { ctaHref: v })} placeholder="/r/some-restaurant" />
                </Field>
                <Field label="Style">
                  <select
                    value={s.ctaStyle}
                    onChange={(e) => update(i, { ctaStyle: e.target.value as SlideCtaStyle })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="primary">Primary (filled)</option>
                    <option value="secondary">Secondary (white)</option>
                    <option value="outline">Outline (glassy)</option>
                  </select>
                </Field>
              </div>
              {/* Tiny live-preview row — gives editors immediate confidence in
                  what the CTA will look like without waiting for save + reload. */}
              {(s.eyebrow || s.headline || s.subtext || s.ctaLabel) && (
                <div className="rounded-md bg-foreground p-3 text-white">
                  {s.eyebrow && (
                    <span className="inline-flex rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      {s.eyebrow}
                    </span>
                  )}
                  {s.headline && <div className="mt-1 text-base font-bold">{s.headline}</div>}
                  {s.subtext && <div className="mt-0.5 text-xs text-white/80">{s.subtext}</div>}
                  {s.ctaLabel && (
                    <div className="mt-2">
                      <span className={
                        s.ctaStyle === 'outline' ? 'inline-flex items-center gap-1 rounded-full border border-white/80 px-3 py-1 text-xs font-semibold'
                        : s.ctaStyle === 'secondary' ? 'inline-flex items-center gap-1 rounded-full bg-white text-foreground px-3 py-1 text-xs font-semibold'
                        : 'inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold'
                      }>
                        {s.ctaLabel} →
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setCfg((c) => ({ ...c, carousel: { ...c.carousel, slides: [...c.carousel.slides, {
          src: '', alt: '', href: '', fallback: 'from-[#ff5a2c] via-[#ff3b30] to-[#e0286f]', enabled: true,
          eyebrow: '', headline: '', subtext: '', ctaLabel: '', ctaHref: '', ctaStyle: 'primary' as SlideCtaStyle,
          objectFit: 'contain' as SlideObjectFit, focalPoint: 'center',
          overlayPosition: 'bottom-left' as SlideOverlayPosition, overlayDarkness: 60,
          mediaType: 'image' as SlideMediaType, videoSrc: '', poster: '',
          videoAutoplay: true, videoLoop: true, videoMuted: true,
        }] } }))}
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

  // Group unpinned offers by lifecycle so the dropdown is scannable. Active
  // first (the only ones that actually surface on the storefront today),
  // then scheduled, paused, expired.
  const LIFECYCLE_LABEL: Record<NonNullable<OfferOpt['lifecycle']>, string> = {
    active: 'Active',
    scheduled: 'Scheduled',
    paused: 'Paused',
    expired: 'Expired',
  };
  const grouped: Record<NonNullable<OfferOpt['lifecycle']>, OfferOpt[]> = {
    active: [], scheduled: [], paused: [], expired: [],
  };
  for (const o of unpinned) grouped[o.lifecycle ?? 'active'].push(o);

  const labelFor = (o: OfferOpt) =>
    `${o.name}${o.code ? ` (${o.code})` : ''}${o.scope ? ` — ${o.scope}` : ''}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle checked={cfg.topOffers.enabled} onChange={(v) => patch('topOffers', { enabled: v })} label="Top offers section" />
        {!cfg.topOffers.enabled && (
          // The user reported "section is not working" — the most common cause
          // is the toggle being off. Make that highly visible inline so they
          // don't need to read the badge label.
          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/10 border border-warning/30 px-2.5 py-1 text-[11px] text-warning-foreground">
            <Sparkles className="size-3 text-warning" />
            Strip is hidden on /restaurants until you turn this on.
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Heading"><Text value={cfg.topOffers.heading} onChange={(v) => patch('topOffers', { heading: v })} max={80} /></Field>
        <Field label="Max tiles shown">
          <input type="number" min={1} max={30} value={cfg.topOffers.limit} onChange={(e) => patch('topOffers', { limit: Number(e.target.value) || 1 })} className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm" />
        </Field>
      </div>
      <Field label="Subheading (optional)"><Text value={cfg.topOffers.subheading} onChange={(v) => patch('topOffers', { subheading: v })} max={200} /></Field>

      <div>
        <p className="text-sm font-medium mb-1">Pinned offers</p>
        <p className="text-xs text-muted-foreground mb-2">
          Pinned offers always appear first (in this order); the rest auto-fill by priority.
          Paused / scheduled / expired offers are listed here so you can pin them in advance —
          they only render on the storefront once they're <strong>active</strong> and inside
          their date window.
        </p>

        {pinned.length === 0 && <p className="text-sm text-muted-foreground">No offers pinned — the strip is fully automatic.</p>}

        <div className="space-y-2">
          {pinned.map((id, i) => {
            const o = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Pin className="size-3.5 text-primary" />
                <span className="flex-1 truncate">
                  {o
                    ? <>
                        {o.name}
                        {o.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{o.code}</span>}
                        {o.scope && <span className="ml-2 text-[11px] text-muted-foreground">· {o.scope}</span>}
                      </>
                    : <span className="text-muted-foreground">Offer {id} (removed)</span>}
                </span>
                {o?.lifecycle && o.lifecycle !== 'active' && <LifecyclePill state={o.lifecycle} />}
                <MoveControls i={i} len={pinned.length} onMove={(f, t) => setPinned(arrayMove(pinned, f, t))} onRemove={() => setPinned(pinned.filter((x) => x !== id))} />
              </div>
            );
          })}
        </div>

        {offers.length === 0 ? (
          // True zero-state — the offer table itself is empty. Point the
          // super-admin at the place where offers are created.
          <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No offers have been created yet. Restaurant admins can add them at{' '}
              <code className="rounded bg-card px-1.5 py-0.5">/admin/offers</code>, and the new offer
              will show up here for you to pin.
            </p>
          </div>
        ) : unpinned.length > 0 && (
          <div className="mt-3">
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) { setPinned([...pinned, e.target.value]); e.target.value = ''; } }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">+ Pin an offer…</option>
              {(['active', 'scheduled', 'paused', 'expired'] as const).map((state) =>
                grouped[state].length > 0 ? (
                  <optgroup key={state} label={LIFECYCLE_LABEL[state]}>
                    {grouped[state].map((o) => (
                      <option key={o.id} value={o.id}>{labelFor(o)}</option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Showing {offers.length} offer{offers.length === 1 ? '' : 's'} across the platform —
              grouped by status. Active offers are eligible to render right now.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LifecyclePill({ state }: { state: NonNullable<OfferOpt['lifecycle']> }) {
  const map: Record<NonNullable<OfferOpt['lifecycle']>, string> = {
    active: 'bg-success/15 text-success border-success/30',
    scheduled: 'bg-warning/15 text-warning border-warning/30',
    paused: 'bg-muted text-muted-foreground border-border',
    expired: 'bg-destructive/15 text-destructive border-destructive/30',
  };
  const label = state[0].toUpperCase() + state.slice(1);
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[state]}`}>{label}</span>;
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

// ────────────────── Carousel size panel (Width + Height) ──────────────────
//
// Same 7 width × 8 height presets as the per-restaurant storefront hero
// (HeroSizePicker in /admin/storefront). Surfaces them as two dropdowns with
// a small hint line per option — full picker tiles felt heavy for the
// already-busy Carousel tab, but the underlying choices are identical so
// /restaurants and /r/<slug> carousels share the exact same vocabulary.
function CarouselSizePanel({
  width,
  height,
  onWidth,
  onHeight,
}: {
  width: HeroWidth;
  height: HeroHeight;
  onWidth: (w: HeroWidth) => void;
  onHeight: (h: HeroHeight) => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <div>
        <h4 className="text-sm font-semibold">Carousel size</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          7 width × 8 height presets. The picked height overrides the legacy
          &quot;Banner shape&quot; field above. Same vocabulary as the per-restaurant
          storefront hero so admins compare like-for-like.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Width" hint={HERO_WIDTH_HINTS[width]}>
          <select
            value={width}
            onChange={(e) => onWidth(e.target.value as HeroWidth)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {HERO_WIDTHS.map((w) => (
              <option key={w} value={w}>{HERO_WIDTH_LABELS[w]}</option>
            ))}
          </select>
        </Field>
        <Field label="Height" hint={HERO_HEIGHT_HINTS[height]}>
          <select
            value={height}
            onChange={(e) => onHeight(e.target.value as HeroHeight)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {HERO_HEIGHTS.map((h) => (
              <option key={h} value={h}>{HERO_HEIGHT_LABELS[h]}</option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Default: <span className="font-medium">Mobile gutter + Wide 2:1</span>{' '}
        — preserves the historical /restaurants look. Try{' '}
        <span className="font-medium">Card + Standard</span> for a more
        contained, premium feel; <span className="font-medium">Full bleed +
        Cinematic</span> for a brochure-style hero.
      </p>
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
