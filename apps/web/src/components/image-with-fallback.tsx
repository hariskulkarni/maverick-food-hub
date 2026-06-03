'use client';

import Image, { type ImageProps } from 'next/image';
import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

/**
 * A drop-in for next/image that degrades gracefully through a cascade:
 *   1. primary `src` (often an uploaded/CMS URL that may 404 on prod)
 *   2. each `fallbackSrc` in order (curated catalog images, generic stock,
 *      whatever the caller wants tried before giving up)
 *   3. on-brand coral gradient placeholder with a knife/fork glyph
 *
 * The cascade fires whenever next/image's <img> reports an `error` event
 * (dead URL, optimizer failure, blocked domain, missing file on disk). This
 * is what stops the discovery "What's on your mind?" tiles from rendering
 * as pink rectangles when a CMS admin uploads a file URL that never made
 * it to prod: the curated fallback image kicks in transparently.
 *
 * Intended for `fill` images inside a `relative` parent (the placeholder is
 * absolutely positioned to match).
 */
type Props = ImageProps & { fallbackSrc?: string | string[] };

export function ImageWithFallback({ src, alt, className, fallbackSrc, ...rest }: Props) {
  // Build the cascade once per src/fallbackSrc combo so React state stays
  // stable when the parent re-renders unrelated props.
  const cascade = (() => {
    const list: (typeof src)[] = [];
    if (src) list.push(src);
    if (Array.isArray(fallbackSrc)) list.push(...fallbackSrc);
    else if (fallbackSrc) list.push(fallbackSrc);
    return list;
  })();

  const [idx, setIdx] = useState(0);
  // Reset cascade index when the primary `src` changes (caller flipped image).
  useEffect(() => { setIdx(0); }, [src, fallbackSrc]);

  const current = cascade[idx];

  // The self-hosted Next image optimizer returns 400 ("isn't a valid image")
  // for local /uploads + /banners files behind the proxy. Those files DO serve
  // fine directly from /public, so render them unoptimized (skip /_next/image).
  // Remote images (Unsplash, CDN) keep optimization.
  const isLocalAsset = typeof current === 'string' && (current.startsWith('/uploads') || current.startsWith('/banners'));

  if (!current) {
    return (
      <div
        role="img"
        aria-label={alt || 'Image unavailable'}
        className="absolute inset-0 grid place-items-center bg-gradient-to-br from-primary/25 via-accent to-secondary"
      >
        <UtensilsCrossed className="size-8 text-primary/60" />
      </div>
    );
  }

  return (
    <Image
      {...rest}
      unoptimized={(rest as { unoptimized?: boolean }).unoptimized ?? isLocalAsset}
      src={current}
      alt={alt}
      className={className}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
