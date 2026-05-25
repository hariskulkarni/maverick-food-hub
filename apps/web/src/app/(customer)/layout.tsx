import Link from 'next/link';
import { auth } from '@/server/auth';
import { brand } from '@/lib/brand';
import { CartProvider } from './cart-context';
import { BrandMark } from '@/components/brand-mark';
import { PlatformNav } from '@/components/landing/platform-nav';
import { MobileBottomNav } from '@/components/mobile/bottom-nav';
import { StickyCartBar } from '@/components/mobile/sticky-cart-bar';
import { SwRegister } from '@/components/pwa/sw-register';
import { InstallPrompt } from '@/components/pwa/install-prompt';

/**
 * Shared layout for the (customer) route group.
 *
 * This wraps BOTH the platform-marketing surface (`/`, `/about`, `/contact`,
 * `/restaurants`, ...) and the tenant storefront (`/r/<slug>/*`). The
 * `<PlatformNav>` client island reads `usePathname()` and renders the right
 * header for each — crucially, the cart/account/order-now controls only appear
 * on tenant routes.
 *
 * `<CartProvider>` still wraps everything because `/r/<slug>/*` pages mount the
 * cart and we don't want context to remount on navigation between platform and
 * tenant routes.
 */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAuthed = !!session?.user;
  const userName = session?.user?.name ?? null;
  const year = new Date().getFullYear();

  return (
    <CartProvider>
      <div className="flex min-h-dvh flex-col">
        {/* Context-aware top nav. Renders marketing chrome on `/` and tenant
            chrome on `/r/<slug>`. */}
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
          <PlatformNav isAuthed={isAuthed} userName={userName} />
        </header>

        {/*
          Mobile-first layout note:
            - The MobileBottomNav is fixed at the viewport bottom on screens < md.
            - That nav is ~56px tall + iOS safe-area-inset, so on mobile we
              reserve scroll-clearance via padding-bottom on <main>. The
              StickyCartBar floats above the nav when the cart is non-empty
              and is accounted for visually (it overlays content, not pushes it).
            - Tablet/desktop: nav hidden, footer + top-nav remain primary.
        */}
        <main className="flex-1 pb-[88px] md:pb-0">{children}</main>

        {/* Mobile-only chrome — both components self-hide on routes that
            shouldn't carry the nav (admin, kitchen, rider, platform, login,
            checkout) and on viewports ≥ md. */}
        <MobileBottomNav />
        <StickyCartBar />

        {/* PWA: register the offline-shell SW + surface a branded install prompt.
            Client islands; safe to render from this server component. */}
        <SwRegister />
        <InstallPrompt />

        {/* ─────────────── Footer (hidden on mobile, replaced by bottom nav) ─────────────── */}
        <footer role="contentinfo" className="hidden md:block border-t bg-muted/30 mt-12">
          <div className="container grid gap-10 py-14 lg:grid-cols-12">
            {/* Brand column */}
            <div className="lg:col-span-4">
              <BrandMark className="text-xl" />
              <p className="mt-3 text-sm text-muted-foreground max-w-xs">{brand.tagline}</p>
              <p className="mt-3 text-sm text-muted-foreground max-w-xs">
                A two-sided food marketplace — customers order, restaurants cook, our riders
                deliver. Built and operated from Andhra Pradesh, India.
              </p>

              {/* Socials */}
              <div className="mt-5 flex gap-3" aria-label="Social links">
                <a href="#" aria-label="Twitter" className="grid size-8 place-items-center rounded-md border hover:bg-accent">
                  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2H21l-6.52 7.45L22 22h-6.93l-4.34-5.69L5.6 22H2.84l6.97-7.96L2 2h7.07l3.93 5.2L18.244 2Zm-2.43 18h1.55L7.27 4H5.6l10.214 16Z" />
                  </svg>
                </a>
                <a href="#" aria-label="Instagram" className="grid size-8 place-items-center rounded-md border hover:bg-accent">
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                  </svg>
                </a>
                <a href="#" aria-label="LinkedIn" className="grid size-8 place-items-center rounded-md border hover:bg-accent">
                  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                    <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4v11.5H3V9.75ZM10 9.75h3.83v1.57h.05c.53-1 1.84-2.07 3.78-2.07 4.04 0 4.79 2.66 4.79 6.12v5.88H18.7v-5.22c0-1.25-.02-2.85-1.74-2.85-1.74 0-2.01 1.36-2.01 2.76v5.31H10V9.75Z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Link columns */}
            <div className="grid grid-cols-2 gap-10 lg:col-span-8 lg:grid-cols-4">
              {/* Company */}
              <div className="text-sm">
                <p className="font-semibold mb-3">Company</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li><Link href="/about" className="hover:text-foreground">About</Link></li>
                  <li><Link href="/careers" className="hover:text-foreground">Careers</Link></li>
                  <li><Link href="/contact" className="hover:text-foreground">Contact</Link></li>
                  <li><a href="#" className="hover:text-foreground">Blog</a></li>
                </ul>
              </div>

              {/* For partners */}
              <div className="text-sm">
                <p className="font-semibold mb-3">For partners</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li><Link href="/signup/restaurant" className="hover:text-foreground">Add your restaurant</Link></li>
                  <li><Link href="/signup/rider" className="hover:text-foreground">Become a rider</Link></li>
                  <li><Link href="/#how-it-works" className="hover:text-foreground">How it works</Link></li>
                  <li><Link href="/login?role=staff" className="hover:text-foreground">Restaurant login</Link></li>
                </ul>
              </div>

              {/* Support */}
              <div className="text-sm">
                <p className="font-semibold mb-3">Support</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li><Link href="/faq" className="hover:text-foreground">Help &amp; FAQ</Link></li>
                  <li><Link href="/contact" className="hover:text-foreground">Contact us</Link></li>
                  <li><Link href="/track" className="hover:text-foreground">Track your order</Link></li>
                  <li><Link href="/orders" className="hover:text-foreground">My orders</Link></li>
                </ul>
              </div>

              {/* Legal */}
              <div className="text-sm">
                <p className="font-semibold mb-3">Legal</p>
                <ul className="space-y-2 text-muted-foreground">
                  <li><Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
                  <li><Link href="/terms" className="hover:text-foreground">Terms of Service</Link></li>
                  <li><Link href="/refunds" className="hover:text-foreground">Refund &amp; Cancellation</Link></li>
                  <li><Link href="/cookies" className="hover:text-foreground">Cookie Policy</Link></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="border-t">
            <div className="container py-4 text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
              <span>© {year} {brand.name}. All rights reserved.</span>
              <span>Built with care for kitchens, customers and riders.</span>
            </div>
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
