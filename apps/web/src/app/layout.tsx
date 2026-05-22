import type { Metadata, Viewport } from 'next';
import { Inter, Bricolage_Grotesque } from 'next/font/google';
import { Toaster } from 'sonner';
import '@/styles/globals.css';
import { brand } from '@/lib/brand';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap', weight: ['400', '500', '600', '700', '800'] });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.tagline,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: brand.name, statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon-180.png' }
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
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
