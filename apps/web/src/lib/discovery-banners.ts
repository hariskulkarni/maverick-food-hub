/**
 * Promo banners shown in the full-bleed carousel on the discovery page
 * (`/restaurants`). Drop the image files into `public/banners/` using these
 * exact names; each should be a 2:1 landscape image (the brand templates are
 * 2600×1300). Order here = order on screen.
 *
 * Slides 1–2 are the official Bowl & Barbeque banners; 3–4 are the matching
 * follow-ups. Until a file exists the carousel renders a branded gradient
 * placeholder (see FeatureCarousel) instead of a broken image.
 */
export interface DiscoveryBanner {
  /** Path under /public. */
  src: string;
  /** Accessible alt text / placeholder caption. */
  alt: string;
  /** Gradient classes used as the loading/fallback background (Tailwind). */
  fallback: string;
}

export const DISCOVERY_BANNERS: DiscoveryBanner[] = [
  {
    src: '/banners/discovery-1.jpg',
    alt: 'Fresh from the pan — freshly baked pizza, just a tap away',
    fallback: 'from-[#ff5a2c] via-[#ff3b30] to-[#e0286f]'
  },
  {
    src: '/banners/discovery-2.jpg',
    alt: 'No third parties — fresh food directly from Bowl & Barbeque',
    fallback: 'from-[#7a1f9e] via-[#c41f8a] to-[#ff5a2c]'
  },
  {
    src: '/banners/discovery-3.jpg',
    alt: 'Wok & Sizzler — wok-tossed happiness in every bite, now just a direct order away',
    fallback: 'from-[#5a0f12] via-[#7a1d10] to-[#e0531f]'
  },
  {
    src: '/banners/discovery-4.jpg',
    alt: 'Combo Nation — more taste, more value, one perfect combo',
    fallback: 'from-[#e07a1f] via-[#c0392b] to-[#1f6f54]'
  }
];
