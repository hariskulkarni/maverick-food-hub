import { ImageWithFallback } from '@/components/image-with-fallback';
import { Instagram, Facebook, Twitter, Youtube, MessageCircle, Globe } from 'lucide-react';
import type { ContentBlock, SocialLinks, StorefrontConfig } from '@/server/storefront-cms';

/**
 * Server-rendered storefront sections driven by the CMS:
 *   • AboutSection   — a "story" block (title + body + optional image)
 *   • ContentBlocks  — composable blocks (richtext / image / cta / gallery /
 *                      embed / spacer) for a given placement (top|bottom of menu)
 *   • SocialLinks    — social/contact icon row
 *   • StorefrontFooter — a custom footer note
 *
 * All take admin-supplied strings; the accent/secondary/radius come from
 * `--sf-*` CSS variables set on the page wrapper (themeStyleVars). Embeds are
 * restricted to https iframes.
 */

const alignClass = (a: ContentBlock['align']) =>
  a === 'center' ? 'text-center mx-auto' : a === 'right' ? 'text-right ml-auto' : 'text-left';

function Richtext({ block }: { block: ContentBlock }) {
  if (!block.title && !block.body) return null;
  return (
    <div className={`max-w-3xl ${alignClass(block.align)}`}>
      {block.title && <h3 className="display text-2xl font-semibold mb-3" style={{ fontFamily: 'var(--sf-font-heading)' }}>{block.title}</h3>}
      {block.body && (
        <div className="prose-sf text-muted-foreground leading-relaxed whitespace-pre-line" style={{ fontFamily: 'var(--sf-font-body)' }}>
          {block.body}
        </div>
      )}
    </div>
  );
}

function ImageBlock({ block }: { block: ContentBlock }) {
  if (!block.src) return null;
  return (
    <figure className={`max-w-4xl ${block.align === 'center' ? 'mx-auto' : block.align === 'right' ? 'ml-auto' : ''}`}>
      <div className="relative aspect-[16/7] w-full overflow-hidden rounded-2xl border bg-muted">
        <ImageWithFallback src={block.src} alt={block.alt ?? block.title ?? 'Storefront image'} fill sizes="100vw" className="object-cover" />
      </div>
      {block.title && <figcaption className={`mt-2 text-sm text-muted-foreground ${alignClass(block.align)}`}>{block.title}</figcaption>}
    </figure>
  );
}

function CtaBlock({ block }: { block: ContentBlock }) {
  return (
    <div className={`max-w-2xl rounded-2xl border bg-gradient-to-br from-[var(--sf-accent)]/5 to-[var(--sf-secondary)]/5 p-6 md:p-8 ${block.align === 'center' ? 'mx-auto text-center' : block.align === 'right' ? 'ml-auto text-right' : ''}`}>
      {block.title && <h3 className="display text-xl md:text-2xl font-semibold" style={{ fontFamily: 'var(--sf-font-heading)' }}>{block.title}</h3>}
      {block.body && <p className="mt-2 text-sm text-muted-foreground">{block.body}</p>}
      {block.ctaLabel && block.ctaHref && (
        <a
          href={block.ctaHref}
          className="mt-4 inline-flex items-center px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-transform hover:scale-[1.03]"
          style={{ backgroundColor: 'var(--sf-accent)', borderRadius: 'var(--sf-btn-radius)' }}
        >
          {block.ctaLabel}
        </a>
      )}
    </div>
  );
}

function GalleryBlock({ block }: { block: ContentBlock }) {
  const imgs = block.images ?? [];
  if (imgs.length === 0) return null;
  return (
    <div className="max-w-5xl mx-auto w-full">
      {block.title && <h3 className="display text-2xl font-semibold mb-4" style={{ fontFamily: 'var(--sf-font-heading)' }}>{block.title}</h3>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {imgs.map((src, i) => (
          <div key={i} className="relative aspect-square overflow-hidden rounded-xl border bg-muted">
            <ImageWithFallback src={src} alt={`${block.title ?? 'Gallery'} ${i + 1}`} fill sizes="(min-width:768px) 33vw, 50vw" className="object-cover transition-transform duration-500 hover:scale-105" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmbedBlock({ block }: { block: ContentBlock }) {
  // Only allow https iframes (defends against javascript:/data: URLs).
  if (!block.embedUrl || !/^https:\/\//i.test(block.embedUrl)) return null;
  return (
    <div className="max-w-4xl mx-auto w-full">
      {block.title && <h3 className="display text-2xl font-semibold mb-4" style={{ fontFamily: 'var(--sf-font-heading)' }}>{block.title}</h3>}
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border bg-muted">
        <iframe
          src={block.embedUrl}
          title={block.title ?? 'Embedded content'}
          className="absolute inset-0 h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          allowFullScreen
        />
      </div>
    </div>
  );
}

function OneBlock({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'richtext': return <Richtext block={block} />;
    case 'image': return <ImageBlock block={block} />;
    case 'cta': return <CtaBlock block={block} />;
    case 'gallery': return <GalleryBlock block={block} />;
    case 'embed': return <EmbedBlock block={block} />;
    case 'spacer': return <div style={{ height: block.height ?? 48 }} aria-hidden />;
    default: return null;
  }
}

export function ContentBlocks({ blocks, position }: { blocks: ContentBlock[]; position: 'top' | 'bottom' }) {
  const list = blocks.filter((b) => b.position === position);
  if (list.length === 0) return null;
  return (
    <div className="container py-6 space-y-8">
      {list.map((b) => <OneBlock key={b.id} block={b} />)}
    </div>
  );
}

export function AboutSection({ about }: { about: StorefrontConfig['about'] }) {
  if (!about.enabled || (!about.body && !about.imageSrc)) return null;
  return (
    <section className="container py-10 border-b">
      <div className={`grid gap-6 items-center ${about.imageSrc ? 'md:grid-cols-2' : ''}`}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--sf-accent)' }}>About</div>
          <h2 className="display mt-1 text-2xl md:text-3xl font-semibold" style={{ fontFamily: 'var(--sf-font-heading)' }}>{about.title}</h2>
          {about.body && <p className="mt-3 text-muted-foreground leading-relaxed whitespace-pre-line max-w-prose" style={{ fontFamily: 'var(--sf-font-body)' }}>{about.body}</p>}
        </div>
        {about.imageSrc && (
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-muted">
            <ImageWithFallback src={about.imageSrc} alt={about.title} fill sizes="(min-width:768px) 50vw, 100vw" className="object-cover" />
          </div>
        )}
      </div>
    </section>
  );
}

const SOCIALS: { key: keyof SocialLinks; label: string; icon: any }[] = [
  { key: 'instagram', label: 'Instagram', icon: Instagram },
  { key: 'facebook', label: 'Facebook', icon: Facebook },
  { key: 'twitter', label: 'Twitter / X', icon: Twitter },
  { key: 'youtube', label: 'YouTube', icon: Youtube },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'website', label: 'Website', icon: Globe },
];

export function SocialLinksRow({ social }: { social: SocialLinks }) {
  const links = SOCIALS.filter((s) => social[s.key]);
  if (links.length === 0) return null;
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      {links.map(({ key, label, icon: Icon }) => {
        const href = key === 'whatsapp' && !/^https?:/i.test(social[key]!) ? `https://wa.me/${social[key]!.replace(/[^\d]/g, '')}` : social[key]!;
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={label}
            className="grid size-10 place-items-center rounded-full border bg-card text-muted-foreground transition-colors hover:text-[var(--sf-accent)] hover:border-[var(--sf-accent)]"
          >
            <Icon className="size-[18px]" />
          </a>
        );
      })}
    </div>
  );
}

export function StorefrontFooter({ footerText, social }: { footerText: string; social: SocialLinks }) {
  const hasSocial = SOCIALS.some((s) => social[s.key]);
  if (!footerText && !hasSocial) return null;
  return (
    <footer className="border-t bg-muted/20">
      <div className="container py-8 space-y-4 text-center">
        {hasSocial && <SocialLinksRow social={social} />}
        {footerText && <p className="text-sm text-muted-foreground max-w-2xl mx-auto whitespace-pre-line">{footerText}</p>}
      </div>
    </footer>
  );
}
