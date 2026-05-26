'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Image as ImageIcon, Images, Plus, Trash2, ArrowUp, ArrowDown, Save, ExternalLink, Eye, EyeOff, ChevronDown, ChevronRight, Star, Loader2, Type, Megaphone, BookOpen, Blocks, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { StorefrontConfig, HeroSlide, HeroTransition, MenuLayout, FontPair, ButtonRadius, CardStyle, ContentBlock, BlockType, BlockPosition, Align } from '@/server/storefront-cms';

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
      if (!r.ok) return toast.error(`Save failed: ${await r.text()}`);
      toast.success('Item order & featured saved'); router.refresh();
    } finally { setSavingItems(false); }
  }

  const setHero = (patch: Partial<StorefrontConfig['hero']>) => setCfg((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  const setBrand = (patch: Partial<StorefrontConfig['branding']>) => setCfg((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  const setLayout = (patch: Partial<StorefrontConfig['layout']>) => setCfg((c) => ({ ...c, layout: { ...c.layout, ...patch } }));
  const setTheme = (patch: Partial<StorefrontConfig['theme']>) => setCfg((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const setAnn = (patch: Partial<StorefrontConfig['announcement']>) => setCfg((c) => ({ ...c, announcement: { ...c.announcement, ...patch } }));
  const setAbout = (patch: Partial<StorefrontConfig['about']>) => setCfg((c) => ({ ...c, about: { ...c.about, ...patch } }));
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
