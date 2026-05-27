import Link from 'next/link';
import { brand } from '@/lib/brand';
import { BrandMark } from '@/components/brand-mark';
import type { DiscoveryConfig } from '@/server/discovery-cms';

/**
 * SiteFooter — the site-wide marketing footer (hidden on mobile, where the
 * bottom nav takes over). Content is fully CMS-driven from the Discovery CMS
 * (super-admin → /platform/discovery-cms → Footer): tagline, blurb, link
 * columns, social links and the legal bar.
 */

type FooterCfg = DiscoveryConfig['footer'];

const SOCIAL_ICONS: Record<keyof FooterCfg['social'], React.ReactNode> = {
  twitter: (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2H21l-6.52 7.45L22 22h-6.93l-4.34-5.69L5.6 22H2.84l6.97-7.96L2 2h7.07l3.93 5.2L18.244 2Zm-2.43 18h1.55L7.27 4H5.6l10.214 16Z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.86.26-1.45 1.5-1.45H16.4V5a21 21 0 0 0-2.3-.12c-2.27 0-3.83 1.39-3.83 3.94V11H7.8v3h2.47v7h3.23Z" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11.5H3V9.75ZM10 9.75h3.83v1.57h.05c.53-1 1.84-2.07 3.78-2.07 4.04 0 4.79 2.66 4.79 6.12v5.88H18.7v-5.22c0-1.25-.02-2.85-1.74-2.85-1.74 0-2.01 1.36-2.01 2.76v5.31H10V9.75Z" />
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M23 12s0-3.2-.4-4.74a2.5 2.5 0 0 0-1.76-1.77C19.3 5.1 12 5.1 12 5.1s-7.3 0-8.84.39A2.5 2.5 0 0 0 1.4 7.26C1 8.8 1 12 1 12s0 3.2.4 4.74a2.5 2.5 0 0 0 1.76 1.77c1.54.39 8.84.39 8.84.39s7.3 0 8.84-.39a2.5 2.5 0 0 0 1.76-1.77C23 15.2 23 12 23 12ZM9.75 15.5v-7l6 3.5-6 3.5Z" />
    </svg>
  ),
};

const SOCIAL_LABELS: Record<keyof FooterCfg['social'], string> = {
  twitter: 'Twitter / X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
};

/** An internal path ("/about") uses next/link; anything else is a plain anchor. */
function FooterAnchor({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
}

export function SiteFooter({ footer, year }: { footer: FooterCfg; year: number }) {
  const socials = (Object.keys(SOCIAL_ICONS) as (keyof FooterCfg['social'])[]).filter((k) => footer.social[k]);

  return (
    <footer role="contentinfo" className="hidden md:block border-t bg-muted/30 mt-12">
      <div className="container grid gap-10 py-14 lg:grid-cols-12">
        {/* Brand column */}
        <div className="lg:col-span-4">
          <BrandMark className="text-xl" />
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">{footer.tagline || brand.tagline}</p>
          {footer.blurb && <p className="mt-3 text-sm text-muted-foreground max-w-xs">{footer.blurb}</p>}

          {socials.length > 0 && (
            <div className="mt-5 flex gap-3" aria-label="Social links">
              {socials.map((k) => (
                <a
                  key={k}
                  href={footer.social[k]}
                  aria-label={SOCIAL_LABELS[k]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid size-8 place-items-center rounded-md border hover:bg-accent"
                >
                  {SOCIAL_ICONS[k]}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Link columns */}
        {footer.columns.length > 0 && (
          <div className="grid grid-cols-2 gap-10 lg:col-span-8 lg:grid-cols-4">
            {footer.columns.map((col, i) => (
              <div key={`${col.title}-${i}`} className="text-sm">
                <p className="font-semibold mb-3">{col.title}</p>
                <ul className="space-y-2 text-muted-foreground">
                  {col.links.map((l, j) => (
                    <li key={`${l.label}-${j}`}>
                      <FooterAnchor href={l.href} className="hover:text-foreground">
                        {l.label}
                      </FooterAnchor>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t">
        <div className="container py-4 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>{footer.legalLeft || `© ${year} ${brand.name}. All rights reserved.`}</span>
          {footer.legalRight && <span>{footer.legalRight}</span>}
        </div>
      </div>
    </footer>
  );
}
