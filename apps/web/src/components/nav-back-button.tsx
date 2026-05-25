'use client';

import { useRouter, usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

/**
 * Contextual in-app back button for the top header.
 *
 * A standalone PWA has no browser chrome (no back/forward), so users get stuck
 * on deep pages. This shows a back affordance on every page EXCEPT the five
 * root destinations already reachable from the bottom nav (Home / Explore /
 * Cart / Orders / Profile) — matching how native food apps behave. Forward is
 * intentionally omitted (not a native-app pattern); Home is the logo + bottom nav.
 *
 * Falls back to Home when there's no in-app history to pop (e.g. the user
 * deep-linked straight into a detail page), so back never dead-ends or exits.
 */
const ROOT_PATHS = new Set(['/', '/restaurants', '/cart', '/orders', '/profile']);

export function NavBackButton() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  // Hide on the canonical tab roots; show on every deeper/detail route.
  if (ROOT_PATHS.has(pathname)) return null;

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      className="-ml-1 mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors tap-press hover:bg-accent"
    >
      <ChevronLeft className="size-5" />
    </button>
  );
}
