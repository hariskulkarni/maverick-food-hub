import type { MetadataRoute } from 'next';

const SITE = 'https://flavrly.in';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/platform', '/kitchen', '/api', '/login']
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE
  };
}
