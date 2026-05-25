'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, User, X } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { CartButton } from '@/app/(customer)/cart-button';
import { NavBackButton } from '@/components/nav-back-button';

/**
 * Context-aware header for the (customer) route group.
 *
 * The (customer) layout wraps BOTH the platform marketing surface (`/`,
 * `/about`, `/contact`, `/restaurants`, ...) and the tenant storefront
 * (`/r/<slug>/*`). The two contexts need very different chrome:
 *
 *   • Platform surface  →  marketing nav, "Sign in" pill. NO cart, NO avatar,
 *                          NO "Order now" button. This page is for restaurants
 *                          and riders, not eaters.
 *   • Tenant storefront →  the familiar customer header: wordmark, account
 *                          avatar (or sign-in), cart.
 *
 * We discriminate on the pathname at the client. Anything under `/r/<slug>` is
 * a tenant surface; everything else is the platform.
 */
export function PlatformNav({
  isAuthed,
  userName
}: {
  isAuthed: boolean;
  userName?: string | null;
}) {
  const pathname = usePathname() ?? '/';
  const isTenant = pathname.startsWith('/r/');

  return isTenant ? (
    <TenantNav isAuthed={isAuthed} userName={userName} pathname={pathname} />
  ) : (
    <MarketingNav isAuthed={isAuthed} userName={userName} pathname={pathname} />
  );
}

/**
 * Mobile only: which routes still warrant a top-right "Sign in" affordance.
 * The bottom nav already gets users to Profile/Cart/Orders, so on deep funnel
 * surfaces (cart, checkout, order tracker, profile subpages) we drop the
 * top-right button entirely and rely on those flows' inline auth prompts.
 */
function shouldShowMobileSignIn(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname === '/restaurants' || pathname.startsWith('/restaurants/')) return true;
  if (pathname.startsWith('/r/')) return true;
  return false;
}

/* ────────────────────────────  Marketing variant  ────────────────────────── */

function MarketingNav({
  isAuthed,
  userName,
  pathname
}: {
  isAuthed: boolean;
  userName?: string | null;
  pathname: string;
}) {
  const showMobileAuth = shouldShowMobileSignIn(pathname);
  return (
    // Mobile compresses py-2; desktop keeps the original h-16 rhythm.
    <div className="container flex items-center gap-4 h-12 py-2 md:h-16 md:py-3">
      <NavBackButton />
      <Link href="/" className="flex items-center gap-2" aria-label="Reshee Tech home">
        {/* Logo: smaller on mobile (text-base) so the slim header reads as
            chrome and not as a hero. */}
        <BrandMark className="text-base md:text-xl" />
      </Link>

      <nav className="ml-8 hidden gap-6 text-sm md:flex" aria-label="Primary">
        <Link className="text-muted-foreground hover:text-foreground transition-colors" href="/#how-it-works">
          How it works
        </Link>
        <Link className="text-muted-foreground hover:text-foreground transition-colors" href="/signup/restaurant">
          For restaurants
        </Link>
        <Link className="text-muted-foreground hover:text-foreground transition-colors" href="/signup/rider">
          Become a rider
        </Link>
        <Link className="text-muted-foreground hover:text-foreground transition-colors" href="/faq">
          Help &amp; FAQ
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* Desktop sign-in pill — always visible. */}
        <Link
          href={isAuthed ? '/profile' : '/login?role=staff'}
          className="hidden md:inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm"
        >
          {isAuthed ? (userName?.split(' ')[0] ?? 'Account') : 'Sign in'}
        </Link>

        {/* Mobile sign-in pill — only on top-of-funnel routes; deep funnel
            relies on its own inline prompts. */}
        {showMobileAuth && !isAuthed && (
          <Link
            href="/login?role=staff"
            className="md:hidden inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            Sign in
          </Link>
        )}

        <MarketingMobileSheet isAuthed={isAuthed} />
      </div>
    </div>
  );
}

function MarketingMobileSheet({ isAuthed }: { isAuthed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  const linkClass =
    'block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-accent';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open menu"
        className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
      >
        <Menu className="size-5" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 h-dvh w-[85vw] max-w-sm border-l bg-background p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex items-center justify-between">
            <BrandMark className="text-lg" />
            <DialogPrimitive.Close
              aria-label="Close menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          <nav className="mt-6 flex flex-col gap-1">
            <Link href="/#how-it-works" className={linkClass} onClick={close}>
              How it works
            </Link>
            <Link href="/signup/restaurant" className={linkClass} onClick={close}>
              For restaurants
            </Link>
            <Link href="/signup/rider" className={linkClass} onClick={close}>
              Become a rider
            </Link>
            <Link href="/faq" className={linkClass} onClick={close}>
              Help &amp; FAQ
            </Link>
          </nav>

          <div className="mt-6 flex flex-col gap-2">
            <Link
              href="/signup/restaurant"
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              onClick={close}
            >
              List your restaurant
            </Link>
            <Link
              href="/signup/rider"
              className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
              onClick={close}
            >
              Become a rider
            </Link>
            {!isAuthed ? (
              <Link
                href="/login?role=staff"
                className="inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={close}
              >
                Already a partner? Sign in
              </Link>
            ) : (
              <Link
                href="/profile"
                className="inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={close}
              >
                My account
              </Link>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ──────────────────────────────  Tenant variant  ─────────────────────────── */

/**
 * Same chrome the customer storefront had before: wordmark, account avatar (or
 * sign-in) and the cart. Cart icon only renders on tenant routes.
 */
function TenantNav({
  isAuthed,
  userName,
  pathname
}: {
  isAuthed: boolean;
  userName?: string | null;
  pathname: string;
}) {
  const showMobileAuth = shouldShowMobileSignIn(pathname);
  return (
    // Slimmer mobile header (h-12, py-2). Desktop keeps h-16.
    <div className="container flex items-center gap-4 h-12 py-2 md:h-16 md:py-3">
      <NavBackButton />
      <Link href="/" className="flex items-center gap-2" aria-label="Reshee Tech home">
        <BrandMark className="text-base md:text-xl" />
      </Link>

      <div className="ml-auto flex items-center gap-2">
        {/* CartButton: kept on desktop, hidden on mobile — the bottom nav owns the Cart tab. */}
        <div className="hidden md:block">
          <CartButton />
        </div>

        {isAuthed ? (
          <Link
            href="/profile"
            className="hidden md:inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent"
          >
            <User className="size-4" />
            {userName?.split(' ')[0] ?? 'Account'}
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="hidden md:inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 shadow-sm"
            >
              Sign in
            </Link>
            {showMobileAuth && (
              <Link
                href="/login"
                className="md:hidden inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                Sign in
              </Link>
            )}
          </>
        )}

        <TenantMobileSheet isAuthed={isAuthed} />
      </div>
    </div>
  );
}

function TenantMobileSheet({ isAuthed }: { isAuthed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  const linkClass =
    'block rounded-md px-3 py-2 text-base font-medium text-foreground hover:bg-accent';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open menu"
        className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
      >
        <Menu className="size-5" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 h-dvh w-[85vw] max-w-sm border-l bg-background p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex items-center justify-between">
            <BrandMark className="text-lg" />
            <DialogPrimitive.Close
              aria-label="Close menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>

          <nav className="mt-6 flex flex-col gap-1">
            <Link href="/track" className={linkClass} onClick={close}>
              Track order
            </Link>
            <Link href="/orders" className={linkClass} onClick={close}>
              My orders
            </Link>
            {isAuthed && (
              <Link href="/profile" className={linkClass} onClick={close}>
                My account
              </Link>
            )}
          </nav>

          {!isAuthed && (
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                onClick={close}
              >
                Sign in
              </Link>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
