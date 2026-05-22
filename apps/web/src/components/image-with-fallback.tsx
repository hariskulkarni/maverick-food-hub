'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

/**
 * A drop-in for next/image that degrades gracefully. If the remote image fails
 * to load (e.g. a dead Unsplash URL, a 404 on an uploaded file, or an optimizer
 * error), instead of the browser's broken-image glyph we render an on-brand
 * coral gradient placeholder. Intended for `fill` images inside a `relative`
 * parent (the placeholder is absolutely positioned to match).
 */
export function ImageWithFallback({ src, alt, className, ...rest }: ImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
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

  return <Image {...rest} src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
