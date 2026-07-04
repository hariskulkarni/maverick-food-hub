'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import { ImageUploader } from '@/components/image-uploader';
import { Image as ImageIcon, Images, Plus, Trash2, ArrowUp, ArrowDown, Save, ExternalLink, Eye, EyeOff, ChevronDown, ChevronRight, Star, Loader2, Type, Megaphone, BookOpen, Blocks, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { StorefrontConfig, HeroSlide, HeroTransition, MenuLayout, FontPair, ButtonRadius, CardStyle, ContentBlock, BlockType, BlockPosition, Align, LogoFit, LogoShape, HeroWidth, HeroHeight } from '@/server/storefront-cms';
import {
  LOGO_FITS, LOGO_SHAPES, LOGO_FIT_LABELS, LOGO_SHAPE_LABELS, LOGO_FIT_CLASS, LOGO_SHAPE_RADIUS_CLASS,
  HERO_WIDTHS, HERO_HEIGHTS, HERO_WIDTH_LABELS, HERO_HEIGHT_LABELS,
  HERO_WIDTH_HINTS, HERO_HEIGHT_HINTS,
  HERO_WIDTH_WRAP_CLASS, HERO_WIDTH_INNER_CLASS, HERO_HEIGHT_CLASS,
  HERO_FITS, HERO_POSITIONS, HERO_FIT_LABELS, HERO_POSITION_LABELS,
} from '@/server/storefront-cms';

type Cat = { id: string; name: string; sortOrder: number; isActive: boolean; itemCount: number };
type Item = { id: string; name: string; sortOrder: number; isAvailable: boolean; isFeatured: boolean };

const newBlockId = () => `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

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
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
      toast.success('Item order & featured saved'); router.refresh();
    } finally { setSavingItems(false); }
  }

  const setHero = (patch: Partial<StorefrontConfig['hero']>) => setCfg((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  const setBrand = (patch: Partial<StorefrontConfig['branding']>) => setCfg((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  const setLayout = (patch: Partial<StorefrontConfig['layout']>) => setCfg((c) => ({ ...c, layout: { ...c.layout, ...patch } }));
  const setInfoBar = (patch: Partial<StorefrontConfig['infoBar']>) => setCfg((c) => ({ ...c, infoBar: { ...c.infoBar, ...patch } }));
  const setTheme = (patch: Partial<StorefrontConfig['theme']>) => setCfg((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const setAnn = (patch: Partial<StorefrontConfig['announcement']>) => setCfg((c) => ({ ...c, announcement: { ...c.announcement, ...patch } }));
  const setAbout = (patch: Partial<StorefrontConfig['about']>) => setCfg((c) => ({ ...c, about: { ...c.about, ...patch } }));
  // ── Storefront sections customers actually see in the menu area ──
  const setTopSellers = (patch: Partial<StorefrontConfig['topSellers']>) =>
    setCfg((c) => ({ ...c, topSellers: { ...c.topSellers, ...patch } }));
  const setCombos = (patch: Partial<StorefrontConfig['combos']>) =>
    setCfg((c) => ({ ...c, combos: { ...c.combos, ...patch } }));
  const setSocial = (patch: Partial<StorefrontConfig['social']>) => setCfg((c) => ({ ...c, social: { ...c.social, ...patch } }));
  const setSeo = (patch: Partial<StorefrontConfig['seo']>) => setCfg((c) => ({ ...c, seo: { ...c.seo, ...patch } }));
  const setFooter = (patch: Partial<StorefrontConfig['footer']>) => setCfg((c) => ({ ...c, footer: { ...c.footer, ...patch } }));

  // ── Content blocks ──
  const setBlock = (i: number, patch: Partial<ContentBlock>) =>
    setCfg((c) => ({ ...c, blocks: c.blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) }));
  const addBlock = (type: BlockType) =>
    setCfg((c) => ({ ...c, blocks: [...c.blocks, { id: newBlockId(), type, position: 'bottom', align: 'left' } as ContentBlock] }));
  const removeBlock = (i: number) => setCfg((c) => ({ ...c, blocks: c.blocks.filter((_, idx) => idx !== i) }));
  const moveBlock = (i: number, dir: -1 | 1) =>
    setCfg((c) => {
      const arr = [...c.blocks]; const j = i + dir; if (j < 0 || j >= arr.length) return c;
      [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...c, blocks: arr };
    });
  const setGalleryImg = (i: number, gi: number, val: string) =>
    setBlock(i, { images: (cfg.blocks[i].images ?? []).map((s, idx) => (idx === gi ? val : s)) });
  const addGalleryImg = (i: number) => setBlock(i, { images: [...(cfg.blocks[i].images ?? []), ''] });
  const removeGalleryImg = (i: number, gi: number) => setBlock(i, { images: (cfg.blocks[i].images ?? []).filter((_, idx) => idx !== gi) });
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
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
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
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
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

        {/* SIZE — applies to BOTH cover and carousel hero, so it sits OUTSIDE
            the carousel-only block. Width + Height presets are CMS-controlled
            and rendered identically here and on the customer page (same class
            map, one source of truth). */}
        <HeroSizePicker
          width={cfg.hero.width}
          height={cfg.hero.height}
          onWidth={(w) => setHero({ width: w })}
          onHeight={(h) => setHero({ height: h })}
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Field label="Hero image fit">
            <select value={cfg.hero.imageFit} onChange={(e) => setHero({ imageFit: e.target.value as StorefrontConfig['hero']['imageFit'] })}
              className="h-9 rounded-md border bg-background px-2 text-sm w-[210px]">
              {HERO_FITS.map((f) => <option key={f} value={f}>{HERO_FIT_LABELS[f]}</option>)}
            </select>
          </Field>
          <Field label="Focal position">
            <select value={cfg.hero.imagePosition} onChange={(e) => setHero({ imagePosition: e.target.value as StorefrontConfig['hero']['imagePosition'] })}
              className="h-9 rounded-md border bg-background px-2 text-sm w-[150px]">
              {HERO_POSITIONS.map((pos) => <option key={pos} value={pos}>{HERO_POSITION_LABELS[pos]}</option>)}
            </select>
          </Field>
          <p className="w-full text-xs text-muted-foreground">“Cover” fills the box (may crop the edges); “Contain” shows the whole image (may letterbox). Focal position picks which part stays visible when cropped.</p>
        </div>

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
                    <div className="inline-flex rounded-md border p-0.5 text-[11px] font-medium">
                      {(['image', 'video'] as const).map((k) => (
                        <button key={k} type="button" onClick={() => setSlide(i, { mediaType: k })}
                          className={`rounded px-2 py-0.5 capitalize ${(s.mediaType ?? 'image') === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                          {k}
                        </button>
                      ))}
                    </div>
                    <div className="ml-auto flex gap-1">
                      <IconBtn onClick={() => moveSlide(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></IconBtn>
                      <IconBtn onClick={() => moveSlide(i, 1)} disabled={i === cfg.hero.slides.length - 1}><ArrowDown className="size-3.5" /></IconBtn>
                      <IconBtn onClick={() => removeSlide(i)} danger><Trash2 className="size-3.5" /></IconBtn>
                    </div>
                  </div>
                  {(s.mediaType ?? 'image') === 'video' ? (
                    <div className="space-y-2">
                      <ImageUploader kind="video" value={s.videoSrc} onChange={(u) => setSlide(i, { videoSrc: u || '' })} folder="banners" aspect="wide" label="Hero video (MP4/WebM · ≤ 50 MB)" />
                      <Input placeholder="…or paste video URL (mp4/webm, YouTube, or Vimeo)" value={s.videoSrc ?? ''} onChange={(e) => setSlide(i, { videoSrc: e.target.value })} className="h-9" />
                      <ImageUploader value={s.poster} onChange={(u) => setSlide(i, { poster: u || '' })} folder="banners" aspect="wide" label="Poster image (shown before the video plays)" />
                      <div className="flex flex-wrap items-center gap-4 rounded-md border bg-background px-3 py-2 text-xs">
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={s.videoAutoplay ?? true} onChange={(e) => setSlide(i, { videoAutoplay: e.target.checked })} /> Autoplay</label>
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={s.videoLoop ?? true} onChange={(e) => setSlide(i, { videoLoop: e.target.checked })} /> Loop</label>
                        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={s.videoMuted ?? true} onChange={(e) => setSlide(i, { videoMuted: e.target.checked })} /> Muted</label>
                      </div>
                    </div>
                  ) : (
                    <Input placeholder="Image URL (e.g. /banners/slide1.jpg or https://…)" value={s.src} onChange={(e) => setSlide(i, { src: e.target.value })} className="h-9" />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Headline (optional)" value={s.headline ?? ''} onChange={(e) => setSlide(i, { headline: e.target.value })} className="h-9" />
                    <Input placeholder="Subtext (optional)" value={s.subtext ?? ''} onChange={(e) => setSlide(i, { subtext: e.target.value })} className="h-9" />
                    <Input placeholder="Button label (optional)" value={s.ctaLabel ?? ''} onChange={(e) => setSlide(i, { ctaLabel: e.target.value })} className="h-9" />
                    <Input placeholder="Button link (optional)" value={s.ctaHref ?? ''} onChange={(e) => setSlide(i, { ctaHref: e.target.value })} className="h-9" />
                  </div>
                  {(s.mediaType ?? 'image') !== 'video' && s.src && (
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

        {/* LOGO DISPLAY — fit/shape/padding/background controls. The
            equivalent CSS class names live in @/server/storefront-cms so the
            editor preview and the public storefront render IDENTICALLY (one
            source of truth, no divergent styling). */}
        <LogoDisplayPanel
          value={cfg.branding.logoDisplay}
          onChange={(d) => setBrand({ logoDisplay: d })}
        />
      </Section>

      {/* THEME */}
      <Section title="Theme — colours & fonts" subtitle="Set a secondary accent, pick a font pairing and the button/card style for your page.">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Secondary colour">
            <div className="flex items-center gap-2">
              <input type="color" value={cfg.theme.secondaryColor} onChange={(e) => setTheme({ secondaryColor: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
              <Input value={cfg.theme.secondaryColor} onChange={(e) => setTheme({ secondaryColor: e.target.value })} className="h-9 w-[110px] font-mono" />
            </div>
          </Field>
          <Field label="Font pairing">
            <select value={cfg.theme.fontPair} onChange={(e) => setTheme({ fontPair: e.target.value as FontPair })} className="h-9 rounded-md border bg-background px-2 text-sm w-[160px]">
              <option value="modern">Modern (Jakarta + Inter)</option>
              <option value="classic">Classic (Playfair + Source)</option>
              <option value="playful">Playful (Poppins + Nunito)</option>
              <option value="editorial">Editorial (Fraunces)</option>
            </select>
          </Field>
        </div>
        <Field label="Button style">
          <div className="flex gap-2">
            {(['sharp', 'rounded', 'pill'] as ButtonRadius[]).map((r) => (
              <Choice key={r} active={cfg.theme.buttonRadius === r} onClick={() => setTheme({ buttonRadius: r })} label={r[0].toUpperCase() + r.slice(1)} />
            ))}
          </div>
        </Field>
        <Field label="Card style">
          <div className="flex gap-2">
            {(['flat', 'shadow', 'border'] as CardStyle[]).map((s) => (
              <Choice key={s} active={cfg.theme.cardStyle === s} onClick={() => setTheme({ cardStyle: s })} label={s[0].toUpperCase() + s.slice(1)} />
            ))}
          </div>
        </Field>
      </Section>

      {/* ANNOUNCEMENT BAR */}
      <Section title="Announcement bar" subtitle="A slim, dismissible promo bar pinned to the very top of your page.">
        <Toggle on={cfg.announcement.enabled} onClick={() => setAnn({ enabled: !cfg.announcement.enabled })} label="Show announcement bar" />
        {cfg.announcement.enabled && (
          <>
            <Field label="Message">
              <Input value={cfg.announcement.text} onChange={(e) => setAnn({ text: e.target.value })} placeholder="e.g. Free delivery on orders over ₹299 today!" className="h-9" />
            </Field>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Link label (optional)">
                <Input value={cfg.announcement.linkLabel} onChange={(e) => setAnn({ linkLabel: e.target.value })} placeholder="Order now" className="h-9" />
              </Field>
              <Field label="Link URL (optional)">
                <Input value={cfg.announcement.linkHref} onChange={(e) => setAnn({ linkHref: e.target.value })} placeholder="/menu or https://…" className="h-9" />
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Background">
                <div className="flex items-center gap-2">
                  <input type="color" value={cfg.announcement.bgColor} onChange={(e) => setAnn({ bgColor: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={cfg.announcement.bgColor} onChange={(e) => setAnn({ bgColor: e.target.value })} className="h-9 w-[110px] font-mono" />
                </div>
              </Field>
              <Field label="Text colour">
                <div className="flex items-center gap-2">
                  <input type="color" value={cfg.announcement.textColor} onChange={(e) => setAnn({ textColor: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={cfg.announcement.textColor} onChange={(e) => setAnn({ textColor: e.target.value })} className="h-9 w-[110px] font-mono" />
                </div>
              </Field>
            </div>
            <div className="rounded-md px-3 py-2 text-center text-sm font-medium" style={{ backgroundColor: cfg.announcement.bgColor, color: cfg.announcement.textColor }}>
              {cfg.announcement.text || 'Announcement preview'}{cfg.announcement.linkLabel ? ` · ${cfg.announcement.linkLabel}` : ''}
            </div>
          </>
        )}
      </Section>

      {/* ABOUT / STORY */}
      <Section title="About / Story section" subtitle="Tell customers your story — shown above the menu.">
        <Toggle on={cfg.about.enabled} onClick={() => setAbout({ enabled: !cfg.about.enabled })} label="Show about section" />
        {cfg.about.enabled && (
          <>
            <Field label="Title">
              <Input value={cfg.about.title} onChange={(e) => setAbout({ title: e.target.value })} placeholder="Our story" className="h-9 w-[320px]" />
            </Field>
            <Field label="Body">
              <TextArea value={cfg.about.body} onChange={(v) => setAbout({ body: v })} placeholder="Since 1990, we've grilled over open flame…" rows={4} />
            </Field>
            <Field label="Image URL (optional)">
              <Input value={cfg.about.imageSrc} onChange={(e) => setAbout({ imageSrc: e.target.value })} placeholder="/about/story.jpg or https://…" className="h-9" />
            </Field>
            {cfg.about.imageSrc && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={cfg.about.imageSrc} alt="About" className="h-32 w-full max-w-md object-cover rounded-md border" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
            )}
          </>
        )}
      </Section>

      {/* CONTENT BLOCKS */}
      <Section title="Content blocks" subtitle="Compose your page like a website builder — add rich text, images, galleries, calls-to-action, videos/maps, and spacers above or below the menu.">
        <div className="space-y-3">
          {cfg.blocks.map((b, i) => (
            <div key={b.id} className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary capitalize">
                  {blockIcon(b.type)} {b.type}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <select value={b.position} onChange={(e) => setBlock(i, { position: e.target.value as BlockPosition })} className="h-7 rounded-md border bg-background px-1.5 text-xs">
                    <option value="top">Above menu</option>
                    <option value="bottom">Below menu</option>
                  </select>
                  <AlignPicker value={b.align} onChange={(a) => setBlock(i, { align: a })} />
                  <IconBtn onClick={() => moveBlock(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></IconBtn>
                  <IconBtn onClick={() => moveBlock(i, 1)} disabled={i === cfg.blocks.length - 1}><ArrowDown className="size-3.5" /></IconBtn>
                  <IconBtn onClick={() => removeBlock(i)} danger><Trash2 className="size-3.5" /></IconBtn>
                </div>
              </div>

              {b.type !== 'spacer' && (
                <Input placeholder="Heading (optional)" value={b.title ?? ''} onChange={(e) => setBlock(i, { title: e.target.value })} className="h-9" />
              )}

              {b.type === 'richtext' && (
                <TextArea value={b.body ?? ''} onChange={(v) => setBlock(i, { body: v })} placeholder="Write a paragraph… (line breaks are preserved)" rows={4} />
              )}

              {b.type === 'image' && (
                <>
                  <Input placeholder="Image URL" value={b.src ?? ''} onChange={(e) => setBlock(i, { src: e.target.value })} className="h-9" />
                  <Input placeholder="Alt text (optional)" value={b.alt ?? ''} onChange={(e) => setBlock(i, { alt: e.target.value })} className="h-9" />
                  {b.src && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={b.src} alt="" className="h-28 w-full object-cover rounded-md border" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
                  )}
                </>
              )}

              {b.type === 'cta' && (
                <>
                  <TextArea value={b.body ?? ''} onChange={(v) => setBlock(i, { body: v })} placeholder="Supporting text (optional)" rows={2} />
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Button label" value={b.ctaLabel ?? ''} onChange={(e) => setBlock(i, { ctaLabel: e.target.value })} className="h-9" />
                    <Input placeholder="Button link (/reserve or https://…)" value={b.ctaHref ?? ''} onChange={(e) => setBlock(i, { ctaHref: e.target.value })} className="h-9" />
                  </div>
                </>
              )}

              {b.type === 'gallery' && (
                <div className="space-y-1.5">
                  {(b.images ?? []).map((src, gi) => (
                    <div key={gi} className="flex items-center gap-2">
                      <Input placeholder={`Image ${gi + 1} URL`} value={src} onChange={(e) => setGalleryImg(i, gi, e.target.value)} className="h-9" />
                      <IconBtn onClick={() => removeGalleryImg(i, gi)} danger><Trash2 className="size-3.5" /></IconBtn>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => addGalleryImg(i)}><Plus className="size-3.5" /> Add image</Button>
                </div>
              )}

              {b.type === 'embed' && (
                <>
                  <Input placeholder="Embed URL (https:// — YouTube embed, Google Maps, etc.)" value={b.embedUrl ?? ''} onChange={(e) => setBlock(i, { embedUrl: e.target.value })} className="h-9" />
                  <p className="text-[11px] text-muted-foreground">Use the iframe/embed URL (e.g. https://www.youtube.com/embed/…). Only https links are allowed.</p>
                </>
              )}

              {b.type === 'spacer' && (
                <Field label={`Height — ${b.height ?? 48}px`}>
                  <input type="range" min={8} max={240} step={4} value={b.height ?? 48} onChange={(e) => setBlock(i, { height: Number(e.target.value) })} className="w-full max-w-xs" />
                </Field>
              )}
            </div>
          ))}
          {cfg.blocks.length === 0 && <p className="text-xs text-muted-foreground">No content blocks yet — add one below.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {(['richtext', 'image', 'gallery', 'cta', 'embed', 'spacer'] as BlockType[]).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => addBlock(t)} className="capitalize">
                <Plus className="size-3.5" /> {t}
              </Button>
            ))}
          </div>
        </div>
      </Section>

      {/* SOCIAL */}
      <Section title="Social & contact links" subtitle="Shown as icons in your storefront footer.">
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label="Instagram"><Input value={cfg.social.instagram ?? ''} onChange={(e) => setSocial({ instagram: e.target.value })} placeholder="https://instagram.com/…" className="h-9" /></Field>
          <Field label="Facebook"><Input value={cfg.social.facebook ?? ''} onChange={(e) => setSocial({ facebook: e.target.value })} placeholder="https://facebook.com/…" className="h-9" /></Field>
          <Field label="Twitter / X"><Input value={cfg.social.twitter ?? ''} onChange={(e) => setSocial({ twitter: e.target.value })} placeholder="https://x.com/…" className="h-9" /></Field>
          <Field label="YouTube"><Input value={cfg.social.youtube ?? ''} onChange={(e) => setSocial({ youtube: e.target.value })} placeholder="https://youtube.com/@…" className="h-9" /></Field>
          <Field label="WhatsApp"><Input value={cfg.social.whatsapp ?? ''} onChange={(e) => setSocial({ whatsapp: e.target.value })} placeholder="+91… or wa.me link" className="h-9" /></Field>
          <Field label="Website"><Input value={cfg.social.website ?? ''} onChange={(e) => setSocial({ website: e.target.value })} placeholder="https://…" className="h-9" /></Field>
        </div>
      </Section>

      {/* SEO */}
      <Section title="SEO & sharing" subtitle="How your page appears in Google results and when shared on social media.">
        <Field label="Meta title">
          <Input value={cfg.seo.metaTitle} onChange={(e) => setSeo({ metaTitle: e.target.value })} placeholder="Defaults to your restaurant name" className="h-9" />
        </Field>
        <Field label="Meta description">
          <TextArea value={cfg.seo.metaDescription} onChange={(v) => setSeo({ metaDescription: v })} placeholder="A short summary for search engines (≈150 chars)." rows={2} />
        </Field>
        <Field label="Social share image (OG image) URL">
          <Input value={cfg.seo.ogImage} onChange={(e) => setSeo({ ogImage: e.target.value })} placeholder="Defaults to your cover image" className="h-9" />
        </Field>
      </Section>

      {/* FOOTER */}
      <Section title="Footer note" subtitle="A custom message shown at the bottom of your page.">
        <TextArea value={cfg.footer.text} onChange={(v) => setFooter({ text: v })} placeholder="e.g. Open 11am–11pm daily · FSSAI 12345678901234 · © Your Restaurant" rows={2} />
      </Section>

      {/* LAYOUT */}
      <Section title="Info bar (under the hero)" subtitle="The status row beneath your banner — open status, delivery time, rating, city and the verified badge. Hide any chip, or fix the delivery time / rating.">
        <div className="grid sm:grid-cols-2 gap-2">
          <Toggle on={cfg.infoBar.showOpen} onClick={() => setInfoBar({ showOpen: !cfg.infoBar.showOpen })} label="Open / closed status" />
          <Toggle on={cfg.infoBar.showEta} onClick={() => setInfoBar({ showEta: !cfg.infoBar.showEta })} label="Delivery time" />
          <Toggle on={cfg.infoBar.showRating} onClick={() => setInfoBar({ showRating: !cfg.infoBar.showRating })} label="Rating & reviews" />
          <Toggle on={cfg.infoBar.showLocation} onClick={() => setInfoBar({ showLocation: !cfg.infoBar.showLocation })} label="City / location" />
          <Toggle on={cfg.infoBar.showVerified} onClick={() => setInfoBar({ showVerified: !cfg.infoBar.showVerified })} label="Verified badge" />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Delivery time mode">
            <select value={cfg.infoBar.etaMode} onChange={(e) => setInfoBar({ etaMode: e.target.value as StorefrontConfig['infoBar']['etaMode'] })}
              className="h-9 rounded-md border bg-background px-2 text-sm w-[230px]">
              <option value="auto">Auto — live by customer location</option>
              <option value="range">Fixed range (min–max)</option>
              <option value="fixed">Custom label</option>
            </select>
          </Field>
          {cfg.infoBar.etaMode !== 'fixed' ? (
            <>
              <Field label="Min minutes">
                <Input type="number" min={1} max={240} value={cfg.infoBar.etaRangeMin}
                  onChange={(e) => setInfoBar({ etaRangeMin: Number(e.target.value) || 0 })} className="h-9 w-[110px]" />
              </Field>
              <Field label="Max minutes">
                <Input type="number" min={1} max={240} value={cfg.infoBar.etaRangeMax}
                  onChange={(e) => setInfoBar({ etaRangeMax: Number(e.target.value) || 0 })} className="h-9 w-[110px]" />
              </Field>
            </>
          ) : (
            <Field label="Custom delivery label">
              <Input value={cfg.infoBar.etaFixedLabel} onChange={(e) => setInfoBar({ etaFixedLabel: e.target.value })}
                placeholder="e.g. Same-day delivery" className="h-9 w-[230px]" />
            </Field>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Rating source">
            <select value={cfg.infoBar.ratingMode} onChange={(e) => setInfoBar({ ratingMode: e.target.value as StorefrontConfig['infoBar']['ratingMode'] })}
              className="h-9 rounded-md border bg-background px-2 text-sm w-[230px]">
              <option value="auto">Auto — from real customer reviews</option>
              <option value="manual">Manual override</option>
            </select>
          </Field>
          {cfg.infoBar.ratingMode === 'manual' && (
            <>
              <Field label="Rating (e.g. 4.5)">
                <Input value={cfg.infoBar.ratingManualValue} onChange={(e) => setInfoBar({ ratingManualValue: e.target.value })}
                  placeholder="4.5" className="h-9 w-[110px]" />
              </Field>
              <Field label="Review count">
                <Input type="number" min={0} value={cfg.infoBar.ratingManualCount}
                  onChange={(e) => setInfoBar({ ratingManualCount: Number(e.target.value) || 0 })} className="h-9 w-[130px]" />
              </Field>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Auto rating uses your real order reviews (shows “New” until you have enough). Manual override is handy for launch or for super-admins.</p>
      </Section>

      <Section title="Layout & Sections" subtitle="Toggle what customers see and how the menu is laid out.">
        <div className="grid sm:grid-cols-2 gap-2">
          <Toggle on={cfg.layout.showSearch} onClick={() => setLayout({ showSearch: !cfg.layout.showSearch })} label="Search bar" />
          <Toggle on={cfg.layout.showFilters} onClick={() => setLayout({ showFilters: !cfg.layout.showFilters })} label="Filter chips (veg, etc.)" />
          <Toggle on={cfg.layout.showOffersStrip} onClick={() => setLayout({ showOffersStrip: !cfg.layout.showOffersStrip })} label="Offers strip" />
        </div>
        <Field label="Menu layout">
          <div className="flex gap-2">
            {(['list', 'grid'] as MenuLayout[]).map((m) => (
              <Choice key={m} active={cfg.layout.menuLayout === m} onClick={() => setLayout({ menuLayout: m })} label={m === 'list' ? 'List' : 'Grid'} />
            ))}
          </div>
        </Field>
      </Section>

      {/* TOP SELLERS */}
      <Section
        title="Top sellers section"
        subtitle="The “Most ordered here” rail above the menu. Customise every label, how many tiles, and the bestseller badges."
      >
        <Toggle on={cfg.topSellers.enabled} onClick={() => setTopSellers({ enabled: !cfg.topSellers.enabled })} label="Show this section" />
        <div className={`grid gap-3 sm:grid-cols-2 ${cfg.topSellers.enabled ? '' : 'opacity-60 pointer-events-none'}`}>
          <Field label="Eyebrow (small chip)">
            <input
              type="text" value={cfg.topSellers.eyebrow} maxLength={60}
              onChange={(e) => setTopSellers({ eyebrow: e.target.value })}
              placeholder="Most ordered here"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Max tiles shown">
            <input
              type="number" min={1} max={12} value={cfg.topSellers.limit}
              onChange={(e) => setTopSellers({ limit: Number(e.target.value) || 1 })}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>
        <div className={cfg.topSellers.enabled ? '' : 'opacity-60 pointer-events-none'}>
          <Field label="Heading">
            <input
              type="text" value={cfg.topSellers.heading} maxLength={120}
              onChange={(e) => setTopSellers({ heading: e.target.value })}
              placeholder="What everyone keeps coming back for"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Subheading (optional)">
            <input
              type="text" value={cfg.topSellers.subheading} maxLength={240}
              onChange={(e) => setTopSellers({ subheading: e.target.value })}
              placeholder="A soft line under the heading. Leave blank to hide."
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-2 pt-2">
            <Toggle on={cfg.topSellers.showRankBadge} onClick={() => setTopSellers({ showRankBadge: !cfg.topSellers.showRankBadge })} label='"#N BESTSELLER" badge' />
            <Toggle on={cfg.topSellers.showSoldCount} onClick={() => setTopSellers({ showSoldCount: !cfg.topSellers.showSoldCount })} label='"X ordered in 30 days" footnote' />
          </div>
        </div>
      </Section>

      {/* COMBOS */}
      <Section
        title="Combos section"
        subtitle="The “Crowd-pleasers” rail of curated bundles. Customise the eyebrow, headline, how many cards, and whether each card shows the orange Combo pill."
      >
        <Toggle on={cfg.combos.enabled} onClick={() => setCombos({ enabled: !cfg.combos.enabled })} label="Show this section" />
        <div className={`grid gap-3 sm:grid-cols-2 ${cfg.combos.enabled ? '' : 'opacity-60 pointer-events-none'}`}>
          <Field label="Eyebrow (small chip)">
            <input
              type="text" value={cfg.combos.eyebrow} maxLength={60}
              onChange={(e) => setCombos({ eyebrow: e.target.value })}
              placeholder="Combos"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Max combo cards">
            <input
              type="number" min={1} max={12} value={cfg.combos.limit}
              onChange={(e) => setCombos({ limit: Number(e.target.value) || 1 })}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>
        <div className={cfg.combos.enabled ? '' : 'opacity-60 pointer-events-none'}>
          <Field label="Heading">
            <input
              type="text" value={cfg.combos.heading} maxLength={120}
              onChange={(e) => setCombos({ heading: e.target.value })}
              placeholder="Crowd-pleasers"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Subheading (optional)">
            <input
              type="text" value={cfg.combos.subheading} maxLength={240}
              onChange={(e) => setCombos({ subheading: e.target.value })}
              placeholder="A soft line under the heading. Leave blank to hide."
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </Field>
          <div className="pt-2">
            <Toggle on={cfg.combos.showComboBadge} onClick={() => setCombos({ showComboBadge: !cfg.combos.showComboBadge })} label='Orange "Combo" pill on each card' />
          </div>
        </div>

        {/* Live preview */}
        {(cfg.topSellers.enabled || cfg.combos.enabled) && (
          <div className="rounded-lg border bg-muted/30 p-4 mt-3 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Live preview</div>
            {cfg.topSellers.enabled && (
              <div>
                {cfg.topSellers.eyebrow && (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">{cfg.topSellers.eyebrow}</div>
                )}
                {cfg.topSellers.heading && (
                  <div className="display text-base font-semibold">{cfg.topSellers.heading}</div>
                )}
                {cfg.topSellers.subheading && (
                  <div className="text-xs text-muted-foreground">{cfg.topSellers.subheading}</div>
                )}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Up to {cfg.topSellers.limit} bestseller tile{cfg.topSellers.limit === 1 ? '' : 's'}
                  {cfg.topSellers.showRankBadge ? ' · with rank badges' : ''}
                  {cfg.topSellers.showSoldCount ? ' · with 30-day order count' : ''}
                </div>
              </div>
            )}
            {cfg.combos.enabled && (
              <div className={cfg.topSellers.enabled ? 'pt-2 border-t' : ''}>
                {cfg.combos.eyebrow && (
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">{cfg.combos.eyebrow}</div>
                )}
                {cfg.combos.heading && (
                  <div className="display text-base font-semibold">{cfg.combos.heading}</div>
                )}
                {cfg.combos.subheading && (
                  <div className="text-xs text-muted-foreground">{cfg.combos.subheading}</div>
                )}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Up to {cfg.combos.limit} combo card{cfg.combos.limit === 1 ? '' : 's'}
                  {cfg.combos.showComboBadge ? ' · with Combo pill' : ''}
                </div>
              </div>
            )}
          </div>
        )}
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

/**
 * Logo display panel. Exposes the four CMS controls — fit, shape, padding,
 * background — and renders a 96 px live preview using the EXACT same CSS
 * classes the storefront does, so what the admin sees is what customers
 * get. The preview falls back to an "L" tile when no logo is uploaded.
 */
function LogoDisplayPanel({
  value,
  onChange,
}: {
  value: StorefrontConfig['branding']['logoDisplay'];
  onChange: (next: StorefrontConfig['branding']['logoDisplay']) => void;
}) {
  const patch = (p: Partial<StorefrontConfig['branding']['logoDisplay']>) =>
    onChange({ ...value, ...p });

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">Logo display</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            How your uploaded logo fills its badge on the storefront hero.
            Defaults are tuned for transparent PNG brand marks.
          </p>
        </div>
        {/* Live preview — mirrors the storefront's logo badge size +
            classes exactly so the admin trusts what they see. */}
        <div
          className={`relative size-20 shrink-0 overflow-hidden border-4 border-background shadow-lg ${LOGO_SHAPE_RADIUS_CLASS[value.shape]}`}
          style={{ background: value.background || 'transparent', padding: `${value.padding}px` }}
          aria-label="Logo display preview"
        >
          <div className="relative h-full w-full grid place-items-center">
            {/* Use the upload route's standard URL pattern OR an inline SVG
                fallback so the panel is useful even before a logo is set. */}
            <span className="text-2xl font-bold text-muted-foreground">L</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fit">
          <select
            value={value.fit}
            onChange={(e) => patch({ fit: e.target.value as LogoFit })}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            {LOGO_FITS.map((f) => (
              <option key={f} value={f}>{LOGO_FIT_LABELS[f]}</option>
            ))}
          </select>
        </Field>
        <Field label="Shape">
          <select
            value={value.shape}
            onChange={(e) => patch({ shape: e.target.value as LogoShape })}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            {LOGO_SHAPES.map((s) => (
              <option key={s} value={s}>{LOGO_SHAPE_LABELS[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Padding">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={24}
              step={1}
              value={value.padding}
              onChange={(e) => patch({ padding: Number(e.target.value) })}
              className="flex-1"
            />
            <span className="font-mono text-xs text-muted-foreground w-10 text-right">{value.padding}px</span>
          </div>
        </Field>
        <Field label="Background">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.background || '#ffffff'}
              onChange={(e) => patch({ background: e.target.value })}
              className="h-9 w-12 rounded border cursor-pointer"
            />
            <Input
              value={value.background}
              onChange={(e) => patch({ background: e.target.value })}
              className="h-9 flex-1 font-mono"
              placeholder="#ffffff"
            />
            <button
              type="button"
              onClick={() => patch({ background: '' })}
              className="text-[11px] text-muted-foreground hover:text-foreground underline"
              title="No background — useful for opaque logos already on a brand colour"
            >
              clear
            </button>
          </div>
        </Field>
      </div>
    </div>
  );
}
/**
 * Hero size picker — surfaces the 7 width × 8 height presets as two
 * Choice-tile grids with a tiny live thumbnail under each preset so admins
 * can see at a glance what each setting will look like before saving.
 *
 * The thumbnail uses the SAME class maps (HERO_WIDTH_WRAP_CLASS,
 * HERO_WIDTH_INNER_CLASS, HERO_HEIGHT_CLASS) that the customer storefront
 * uses, so what admins see here is exactly what customers get.
 */
function HeroSizePicker({
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
    <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">Hero size</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            How wide and tall your hero banner / carousel renders. Applies to
            both modes. Try a few — the live preview shows what each looks like.
          </p>
        </div>
        {/* The "big" preview at the top right — sized so it stays readable in
            the editor without dominating the page. Reuses the real class maps
            so admins can trust what they're seeing. */}
        <HeroPreview width={width} height={height} className="hidden sm:block w-64 shrink-0" />
      </div>

      {/* WIDTH */}
      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground block">Width</label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {HERO_WIDTHS.map((w) => (
            <SizeTile
              key={w}
              active={width === w}
              onClick={() => onWidth(w)}
              label={HERO_WIDTH_LABELS[w]}
              hint={HERO_WIDTH_HINTS[w]}
              swatch={<WidthSwatch width={w} />}
            />
          ))}
        </div>
      </div>

      {/* HEIGHT */}
      <div className="space-y-1.5">
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground block">Height</label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {HERO_HEIGHTS.map((h) => (
            <SizeTile
              key={h}
              active={height === h}
              onClick={() => onHeight(h)}
              label={HERO_HEIGHT_LABELS[h]}
              hint={HERO_HEIGHT_HINTS[h]}
              swatch={<HeightSwatch height={h} />}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: <span className="font-medium">Full bleed + Wide</span> is the
        classic Zomato / Swiggy look. <span className="font-medium">Card +
        Standard</span> looks more like a hosted brand site.
        <span className="font-medium"> Full screen</span> is dramatic but pushes
        the menu below the fold — best for restaurants with strong photography.
      </p>
    </div>
  );
}

/**
 * One tile in the width/height picker. Visually mirrors the existing Choice
 * component but adds room for a swatch thumbnail and a hint line.
 */
function SizeTile({
  active,
  onClick,
  label,
  hint,
  swatch,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  swatch: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-stretch gap-2 rounded-lg border p-2.5 text-left transition-colors ${
        active
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : 'hover:bg-accent border-input'
      }`}
    >
      <div className="grid place-items-center h-16 rounded-md bg-background border overflow-hidden">
        {swatch}
      </div>
      <div className="min-w-0">
        <div className={`text-xs font-semibold truncate ${active ? 'text-primary' : ''}`}>{label}</div>
        <div className="text-[10px] text-muted-foreground leading-snug line-clamp-2">{hint}</div>
      </div>
    </button>
  );
}

/**
 * Tiny SVG swatch that visualises how wide a hero will be on the page,
 * relative to a stylised "phone frame" outline. Quick visual reference so
 * admins don't have to read every label.
 */
function WidthSwatch({ width }: { width: HeroWidth }) {
  // Coordinates are tuned to read at 64×?? — outer = phone frame, inner = hero.
  // Each width preset gets a unique inner rect so the swatches are visually
  // distinguishable at a glance.
  const inner: Record<HeroWidth, { x: number; w: number; r: number; shadow?: boolean }> = {
    'full-bleed':    { x: 0,    w: 100,  r: 0 },
    'wide-95':       { x: 2.5,  w: 95,   r: 1.5, shadow: true },
    'container':     { x: 12,   w: 76,   r: 1 },
    'card':          { x: 10,   w: 80,   r: 3, shadow: true },
    'narrow':        { x: 22,   w: 56,   r: 0.5 },
    'reading':       { x: 16,   w: 68,   r: 0.5 },
    'mobile-gutter': { x: 6,    w: 88,   r: 0.5 },
  };
  const cfg = inner[width];
  return (
    <svg viewBox="0 0 100 32" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {/* Phone / page frame */}
      <rect x="1" y="2" width="98" height="28" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.6" />
      {/* The hero */}
      {cfg.shadow && (
        <rect x={cfg.x} y={9} width={cfg.w} height={14} rx={cfg.r} fill="#000" opacity="0.06" transform="translate(0,1)" />
      )}
      <rect
        x={cfg.x}
        y={8}
        width={cfg.w}
        height={14}
        rx={cfg.r}
        fill="currentColor"
        opacity="0.45"
      />
    </svg>
  );
}

/**
 * Tiny SVG swatch that visualises hero height as a relative bar. Aspect-ratio
 * presets get a notched outline cue; fixed-pixel presets get solid blocks.
 */
function HeightSwatch({ height }: { height: HeroHeight }) {
  // Approximate visual heights for the swatch (0..28).
  const cfg: Record<HeroHeight, { h: number; ratio?: string }> = {
    'compact':     { h: 6 },
    'standard':    { h: 9 },
    'tall':        { h: 14 },
    'cinematic':   { h: 7,  ratio: '21:9' },
    'wide':        { h: 10, ratio: '2:1' },
    'classic':     { h: 11, ratio: '16:9' },
    'half-screen': { h: 17 },
    'full-screen': { h: 26 },
  };
  const c = cfg[height];
  return (
    <svg viewBox="0 0 100 32" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect x="1" y="2" width="98" height="28" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.6" />
      <rect
        x="6"
        y={28 - c.h}
        width="88"
        height={c.h}
        rx="1"
        fill="currentColor"
        opacity="0.45"
      />
      {c.ratio && (
        <text x="50" y="20" textAnchor="middle" fontSize="6" fill="currentColor" opacity="0.7" fontWeight="700">
          {c.ratio}
        </text>
      )}
    </svg>
  );
}

/**
 * Real-CSS preview of the currently-selected width + height. Uses the same
 * class maps as the customer page so admins see exactly what will ship. The
 * box is bounded to a fixed width here (w-64) so the proportions stay
 * representative inside the editor.
 */
function HeroPreview({
  width,
  height,
  className = '',
}: {
  width: HeroWidth;
  height: HeroHeight;
  className?: string;
}) {
  const wrap = HERO_WIDTH_WRAP_CLASS[width];
  const inner = HERO_WIDTH_INNER_CLASS[width];
  const stage = HERO_HEIGHT_CLASS[height];

  // The preview is rendered INSIDE the editor (constrained width), but the
  // production page is full-window. To make the preview honest we wrap the
  // hero in a faux "page" frame so width presets like 'container' (max-w-7xl)
  // visually scale down. Some classes (e.g. 'h-[90dvh]') would be huge inside
  // an editor card, so we cap the rendered height to keep the preview useful.
  return (
    <div className={`relative rounded-md border bg-muted/40 overflow-hidden ${className}`} aria-label="Hero preview">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground px-2 pt-1.5">Preview</div>
      <div className="p-2">
        <div className="relative bg-card border rounded overflow-hidden" style={{ maxHeight: 140 }}>
          {/* Apply the same wrap class the customer page uses, but bounded so
              full-screen / half-screen don't blow up the editor card. */}
          <div className={wrap || 'w-full'}>
            <div
              className={`relative w-full overflow-hidden bg-gradient-to-br from-primary/40 to-secondary/40 ${inner}`}
              // Cap visual height; otherwise full-screen (90dvh) is unreadable.
              style={{ maxHeight: 110 }}
            >
              <div
                className={`relative w-full ${stage}`}
                style={{ maxHeight: 110 }}
                aria-hidden
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
    />
  );
}
function AlignPicker({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  const opts: { v: Align; Icon: any }[] = [
    { v: 'left', Icon: AlignLeft }, { v: 'center', Icon: AlignCenter }, { v: 'right', Icon: AlignRight },
  ];
  return (
    <div className="inline-flex rounded-md border overflow-hidden">
      {opts.map(({ v, Icon }) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-label={`Align ${v}`}
          className={`grid size-7 place-items-center transition-colors ${value === v ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
function blockIcon(type: BlockType) {
  const cls = 'size-3.5';
  switch (type) {
    case 'richtext': return <Type className={cls} />;
    case 'image': return <ImageIcon className={cls} />;
    case 'gallery': return <Images className={cls} />;
    case 'cta': return <Megaphone className={cls} />;
    case 'embed': return <BookOpen className={cls} />;
    case 'spacer': return <Blocks className={cls} />;
    default: return <Blocks className={cls} />;
  }
}
