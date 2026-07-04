import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery-categories';

/**
 * Build a fallback cascade for a WhatsOnYourMind tile.
 *
 * Why this exists: super-admins can create tiles on /platform/discovery-cms
 * with arbitrary labels ("Indian Breads", "South Indian", "Burger") and may
 * either leave the image blank, OR upload a file whose URL gets saved in DB
 * but the file is missing on production (file copy not synced, S3 mis-route,
 * etc.). Either way the tile would render as a pink placeholder.
 *
 * We now pass BOTH the CMS image (if any) as the primary `src` AND a list of
 * curated category images as the `fallbackSrc` to <ImageWithFallback>. When
 * the primary 404s, the component transparently tries each fallback before
 * giving up on the gradient. End-user experience: tiles ALWAYS show an
 * image now, even if the CMS save was incomplete or the file vanished.
 */
const GENERIC_FOOD_IMAGE =
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500&auto=format&fit=crop&q=80';

function buildTileImageCascade(tile: { slug: string; label: string; image: string }) {
  // Primary: CMS-saved value if it looks like a real URL (not blank, not the
  // dev-mode gradient string we used to leak through).
  const primary =
    tile.image && tile.image.trim() && !tile.image.startsWith('linear-gradient')
      ? tile.image
      : '';
  // Fallback ladder: curated catalogue matched by slug, then by label
  // keyword, then a neutral generic food shot. ImageWithFallback walks down
  // the list whenever the previous one errors at the browser layer.
  const fallbacks: string[] = [];
  const bySlug = DISCOVERY_CATEGORIES.find((c) => c.slug === tile.slug);
  if (bySlug?.image) fallbacks.push(bySlug.image);
  const labelLow = tile.label.toLowerCase();
  const byLabel = DISCOVERY_CATEGORIES.find(
    (c) => c.label.toLowerCase() === labelLow || c.match.some((m) => labelLow.includes(m)),
  );
  if (byLabel?.image && byLabel.image !== bySlug?.image) fallbacks.push(byLabel.image);
  fallbacks.push(GENERIC_FOOD_IMAGE);
  // If there's no primary, use the first fallback as primary so we don't
  // start the cascade on an empty string (which would short-circuit to the
  // gradient).
  if (!primary) {
    const [first, ...rest] = fallbacks;
    return { src: first, fallbackSrc: rest };
  }
  return { src: primary, fallbackSrc: fallbacks };
}

/** A renderable tile. `alt` falls back to the label when empty. */
export interface WoymTile {
  slug: string;
  label: string;
  image: string;
  alt?: string;
}

/**
 * "What's on your mind?" — the cross-restaurant food-category rail.
 *
 * A grid of image tiles (Biryani, Pizza, Rolls, …). Each opens a category
 * landing page (/category/<slug>) that lists the dishes in that category across
 * all nearby restaurants. Horizontally scrollable on mobile (app feel), wrapped
 * grid on larger screens. Every tile always shows an image.
 *
 * `heading` and `tiles` are CMS-configurable (super-admin → /platform/discovery-cms);
 * when no `tiles` prop is supplied we fall back to the curated DISCOVERY_CATEGORIES.
 */
export function WhatsOnYourMind({
  heading = "What's on your mind?",
  tiles: tilesProp,
}: {
  heading?: string;
  tiles?: WoymTile[];
} = {}) {
  const tiles: WoymTile[] =
    tilesProp && tilesProp.length > 0
      ? tilesProp
      : DISCOVERY_CATEGORIES.map((c) => ({ slug: c.slug, label: c.label, image: c.image, alt: c.label }));

  return (
    <section className="mb-6 reveal" aria-labelledby="woym-heading">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="size-3.5" />
        <h2 id="woym-heading">{heading}</h2>
      </div>

      {/* Mobile: two-row horizontal scroll (fits ~16 tiles in two lines).
          md+: responsive wrap grid. */}
      <div className="-mx-4 overflow-x-auto no-scrollbar px-4 md:mx-0 md:overflow-visible md:px-0">
        <div className="grid grid-flow-col grid-rows-2 gap-3 md:grid-flow-row md:grid-rows-none md:grid-cols-6 lg:grid-cols-8 md:gap-4">
          {tiles.map((c) => {
            const cascade = buildTileImageCascade(c);
            return (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              className="group flex shrink-0 flex-col items-center gap-2 tap-press"
              aria-label={`Browse ${c.label}`}
            >
              <div className="relative size-20 overflow-hidden rounded-2xl bg-muted ring-1 ring-black/5 shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:shadow-md md:size-full md:aspect-square">
                <ImageWithFallback
                  src={cascade.src}
                  fallbackSrc={cascade.fallbackSrc}
                  alt={c.alt || c.label}
                  fill
                  sizes="(min-width:768px) 14vw, 80px"
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" />
              </div>
              <span className="max-w-[5.5rem] text-center text-xs font-semibold leading-tight text-foreground group-hover:text-primary md:max-w-none">
                {c.label}
              </span>
            </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
