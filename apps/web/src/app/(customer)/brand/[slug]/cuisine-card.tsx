'use client';

/**
 * One cuisine card on the brand umbrella landing.
 *
 * Lightweight client component — the only reason this isn't pure server-side
 * is the hover image-zoom; we want CSS transitions on hover, which means the
 * card needs to be in the React tree as an interactive element. There is NO
 * other state — clicking just navigates via Next's <Link>.
 */
import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Utensils, MapPin, ArrowRight } from 'lucide-react';
import { FOOD_FALLBACK } from '@/lib/food-images';

export interface CuisineCardProps {
  slug: string;
  name: string;
  cuisine: string | null;
  dishCount: number;
  branchCount: number;
  primaryCity: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
}

export function CuisineCard({
  slug,
  name,
  cuisine,
  dishCount,
  branchCount,
  primaryCity,
  coverImageUrl,
  logoUrl
}: CuisineCardProps) {
  const heroImage = coverImageUrl || logoUrl || FOOD_FALLBACK;

  return (
    <Link
      href={`/r/${slug}`}
      className="group block tap-press"
      aria-label={`Open ${name} menu`}
    >
      {/* Chunky corners on mobile (premium feel), tighter on desktop. */}
      <div className="relative overflow-hidden rounded-2xl md:rounded-xl border bg-card card-lift h-full">
        {/* Cover image with hover-zoom. */}
        <div className="relative aspect-[16/9] md:h-52 bg-muted overflow-hidden">
          <Image
            src={heroImage}
            alt={name}
            fill
            loading="lazy"
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-700 group-hover:scale-110"
          />
          {/* Dark gradient so the type stays legible over the image. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

          {/* Saffron sheen — slides in on hover. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-primary/0 via-warning/0 to-primary/0 opacity-0 transition-opacity duration-500 group-hover:from-primary/15 group-hover:via-warning/10 group-hover:to-primary/20 group-hover:opacity-100" />

          {cuisine && (
            <Badge
              variant="muted"
              className="absolute top-3 left-3 bg-white/95 text-foreground backdrop-blur shadow"
            >
              {cuisine}
            </Badge>
          )}

          {logoUrl && (
            <div className="absolute bottom-3 left-3 size-12 rounded-xl overflow-hidden border-2 border-white/90 shadow-lg bg-card">
              <Image
                src={logoUrl}
                alt={`${name} logo`}
                fill
                sizes="48px"
                className="object-cover"
              />
            </div>
          )}

          <div className="absolute bottom-3 right-3">
            <div className="inline-flex items-center gap-1 rounded-full bg-black/40 text-white backdrop-blur px-2.5 py-1 text-[11px] font-medium">
              <Utensils className="size-3" />
              {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}
            </div>
          </div>
        </div>

        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="display text-lg font-semibold leading-snug group-hover:text-primary transition-colors truncate">
                {name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Utensils className="size-3" />
                  {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {branchCount} {branchCount === 1 ? 'branch' : 'branches'}
                </span>
                {primaryCity && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <MapPin className="size-3 opacity-70" />
                    {primaryCity}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:text-primary/80">
            Explore menu
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}
