import type { MetadataRoute } from 'next';
import { prisma } from '@/server/db';

const SITE = 'https://flavrly.in';

// Static info/marketing pages that actually exist under src/app/(customer).
const STATIC_PATHS = [
  '',
  '/restaurants',
  '/about',
  '/contact',
  '/faq',
  '/privacy',
  '/terms',
  '/refunds',
  '/cookies',
  '/careers'
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency: path === '' || path === '/restaurants' ? 'daily' : 'monthly',
    priority: path === '' ? 1 : path === '/restaurants' ? 0.9 : 0.4
  }));

  // Every active storefront. `updatedAt` may be absent on a stale client — fall
  // back to `now` defensively.
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { slug: true, updatedAt: true } as any
  });

  const restaurantEntries: MetadataRoute.Sitemap = restaurants.map((r: any) => ({
    url: `${SITE}/r/${r.slug}`,
    lastModified: r.updatedAt ?? now,
    changeFrequency: 'weekly',
    priority: 0.8
  }));

  return [...staticEntries, ...restaurantEntries];
}
