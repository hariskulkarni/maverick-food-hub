import { auth } from '@/server/auth';
import { CartProvider } from './cart-context';
import { PlatformNav } from '@/components/landing/platform-nav';
import { MobileBottomNav } from '@/components/mobile/bottom-nav';
import { StickyCartBar } from '@/components/mobile/sticky-cart-bar';
import { SwRegister } from '@/components/pwa/sw-register';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { getDiscoveryConfig } from '@/server/discovery-cms';
import { SiteFooter } from '@/components/site-footer';

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
  // Site-wide footer content is super-admin editable (/platform/discovery-cms → Footer).
  const cms = await getDiscoveryConfig();

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

        {/* ─────────────── Footer (hidden on mobile, replaced by bottom nav) ───────────────
            Content is super-admin editable (/platform/discovery-cms → Footer). */}
        {cms.footer.enabled && <SiteFooter footer={cms.footer} year={year} />}
      </div>
    </CartProvider>
  );
}
