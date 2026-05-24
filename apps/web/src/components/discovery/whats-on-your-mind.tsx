import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery-categories';

/**
 * "What's on your mind?" — the cross-restaurant food-category rail.
 *
 * A grid of image tiles (Biryani, Pizza, Rolls, …). Each opens a category
 * landing page (/category/<slug>) that lists the dishes in that category across
 * all nearby restaurants. Horizontally scrollable on mobile (app feel), wrapped
 * grid on larger screens. Every tile always shows an image.
 */
export function WhatsOnYourMind() {
  return (
    <section className="mb-6 reveal" aria-labelledby="woym-heading">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="size-3.5" />
        <h2 id="woym-heading">What&apos;s on your mind?</h2>
      </div>

      {/* Mobile: horizontal scroll. md+: responsive wrap grid. */}
      <div className="-mx-4 overflow-x-auto no-scrollbar px-4 md:mx-0 md:overflow-visible md:px-0">
        <div className="flex gap-3 md:grid md:grid-cols-6 lg:grid-cols-7 md:gap-4">
          {DISCOVERY_CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              className="group flex shrink-0 flex-col items-center gap-2 tap-press"
              aria-label={`Browse ${c.label}`}
            >
              <div className="relative size-20 overflow-hidden rounded-2xl bg-muted ring-1 ring-black/5 shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:shadow-md md:size-full md:aspect-square">
                <ImageWithFallback
                  src={c.image}
                  alt={c.label}
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
          ))}
        </div>
      </div>
    </section>
  );
}
