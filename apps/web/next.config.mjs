/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: new URL('.', import.meta.url).pathname,
  // Lint runs in CI / local dev — it should not gate a production build.
  // TypeScript errors still block the build (ignoreBuildErrors stays false).
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ['twilio', 'nodemailer', 'pdfkit', 'argon2', 'razorpay', '@aws-sdk/client-s3'],
  experimental: {
    serverActions: { bodySizeLimit: '10mb' }
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: '**' }
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }
        ]
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
