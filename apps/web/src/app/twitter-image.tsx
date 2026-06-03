// Twitter card image — reuses the Open Graph image renderer. The route-segment
// config (runtime/alt/size/contentType) is declared DIRECTLY here rather than
// re-exported from ./opengraph-image, because Next.js can't statically read a
// re-exported `runtime` and emitted a build warning when it was re-exported.
import { brand } from '@/lib/brand';

export { default } from './opengraph-image';

export const runtime = 'edge';
export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
