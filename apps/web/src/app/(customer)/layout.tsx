import { headers } from 'next/headers';
import { auth } from '@/server/auth';
import { isPortalHost } from '@/server/hosts';
import { PortalTopBar } from '@/components/portal-top-bar';
import { CartProvider } from './cart-context';
import { PlatformNav } from '@/components/landing/platform-nav';
import { MobileBottomNav } from '@/components/mobile/bottom-nav';
import { StickyCartBar } from '@/components/mobile/sticky-cart-bar';
import { SwRegister } from '@/components/pwa/sw-register';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { getDiscoveryConfig } from '@/server/discovery-cms';
import { SiteFooter } from '@/components/site-footer';
import { DemoBanner } from '@/components/demo-banner';
import { CookieConsent } from '@/components/cookie-consent';

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

  // On the staff portal (portal.flavrly.in) the only (customer)-group page
  // served is /login. Render a minimal portal chrome instead of the consumer
  // marketing nav / footer / PWA prompts.
  const isPortal = isPortalHost((await headers()).get('host'));
  if (isPortal) {
    return (
      <div className="flex min-h-dvh flex-col max-w-[100vw] overflow-x-hidden">
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
          <PortalTopBar />
        </header>
        <main className="flex-1 w-full max-w-full overflow-x-hidden">{children}</main>
        <CookieConsent />
      </div>
    );
  }

  return (
    <CartProvider>
      {/* Outermost width clamp. max-w-[100vw] + overflow-x-hidden together
          guarantee no descendant — even one with a hard-coded pixel width —
          can ever make the page horizontally scrollable on phones. This is
          a universal safety net that beats overflow-x-clip on older iOS
          Safari (the user-reported case). The sticky <header> still works
          because we don't put overflow on it directly. */}
      <div className="flex min-h-dvh flex-col max-w-[100vw] overflow-x-hidden">
        <DemoBanner />
        {/* Context-aware top nav. Renders marketing chrome on `/` and tenant
            chrome on `/r/<slug>`. */}
        <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
          <PlatformNav isAuthed={isAuthed} userName={userName} role={session?.user?.role ?? null} />
        </header>

        {/*
          Mobile-first layout note:
            - The MobileBottomNav is fixed at the viewport bottom on screens < md.
            - That nav is ~56px tall + iOS safe-area-inset, so on mobile we
              reserve scroll-clearance via padding-bottom on <main>. The
              StickyCartBar floats above the nav when the cart is non-empty
              and is accounted for visually (it overlays content, not pushes it).
            - Tablet/desktop: nav hidden, footer + top-nav remain primary.
            - Belt-and-braces: width clamp on <main> too so a sticky child can
              never escape its bounds.
        */}
        <main className="flex-1 pb-[88px] md:pb-0 w-full max-w-full overflow-x-hidden">{children}</main>

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

      {/* DPDP consent capture — strictly-necessary cookies only until accepted. */}
      <CookieConsent />
    </CartProvider>
  );
}
