import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import '@/styles/globals.css';
import { brand } from '@/lib/brand';

// One friendly geometric-sans family across the whole product (body + headings),
// mirroring Swiggy's single-typeface look. `--font-display` is bound to the same
// family in globals.css (headings just use heavier weights).
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://flavrly.in'),
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
  keywords: [
    'food delivery',
    'order food online',
    'Guntur restaurants',
    'Guntur food delivery',
    'Andhra Pradesh food delivery',
    brand.name,
    'restaurants near me'
  ],
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: brand.name, statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: brand.name,
    description: brand.tagline,
    url: 'https://flavrly.in',
    locale: 'en_IN'
  },
  twitter: {
    card: 'summary_large_image',
    title: brand.name,
    description: brand.tagline
  }
};

export const viewport: Viewport = {
  themeColor: '#f23e5c',
  width: 'device-width',
  initialScale: 1,
  // viewport-fit=cover lets us read iOS env(safe-area-inset-*) so the bottom
  // nav + sticky cart bar + place-order CTA can clear the home indicator on
  // notched devices. Pair with the `.safe-bottom` / `.safe-top` utilities in
  // globals.css.
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
