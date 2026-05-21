/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: do NOT set `output: 'standalone'`. Production runs via `pm2 → next start`
  // (see scripts/deploy-remote.sh + the rm-web pm2 process). Standalone mode emits
  // `.next/standalone/server.js` and makes `next start` serve an inconsistent build
  // ("next start does not work with output: standalone"), which caused stale/old
  // pages to be served after deploys. With standalone off, `next start` serves the
  // freshly built `.next` correctly.
  // Lint runs in CI / local dev — it should not gate a production build.
  // TypeScript errors still block the build (ignoreBuildErrors stays false).
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ['twilio', 'nodemailer', 'pdfkit', 'argon2', 'razorpay', '@aws-sdk/client-s3'],
  experimental: {
    serverActions: { bodySizeLimit: '10mb' }
  },
  images: {
    // Allowlist only — no wildcard `**`. Unsplash covers seed/demo imagery.
    // Restaurant-uploaded images are served from the same origin (local storage)
    // or your configured object store: set IMAGE_CDN_HOST (e.g. cdn.example.com
    // or my-bucket.s3.ap-south-1.amazonaws.com) to allow that host too.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      { protocol: 'https', hostname: '**.unsplash.com' },
      ...(process.env.IMAGE_CDN_HOST
        ? [{ protocol: 'https', hostname: process.env.IMAGE_CDN_HOST }]
        : [])
    ]
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';

    // Content-Security-Policy. Pragmatic, allowlist-based: it locks down framing,
    // object/base/form targets and bounds where scripts/styles/images/connections
    // may come from, while explicitly allowing the third parties this app needs —
    // Razorpay (checkout + API), Google (OAuth + Maps), and OpenStreetMap/Leaflet
    // tiles. script/style keep 'unsafe-inline' (and script 'unsafe-eval') because
    // Next.js App Router + Razorpay's inline checkout need them; tightening to a
    // nonce-based policy is a follow-up that requires per-request nonces.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com https://maps.googleapis.com https://accounts.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://images.unsplash.com https://*.unsplash.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://maps.googleapis.com https://*.googleusercontent.com" +
        (process.env.IMAGE_CDN_HOST ? ` https://${process.env.IMAGE_CDN_HOST}` : ''),
      "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com https://maps.googleapis.com https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org",
      "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://accounts.google.com",
      "worker-src 'self' blob:",
      ...(isProd ? ['upgrade-insecure-requests'] : []),
    ].join('; ');

    const securityHeaders = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
      // HSTS only in production (and only meaningful over HTTPS). 2 years + preload.
      ...(isProd
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
        : []),
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders
      },
      {
        source: '/api/events',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
          { key: 'Connection', value: 'keep-alive' },
          { key: 'X-Accel-Buffering', value: 'no' }
        ]
      }
    ];
  }
};

export default nextConfig;
