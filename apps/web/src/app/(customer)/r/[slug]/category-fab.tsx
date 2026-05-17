'use client';

/**
 * Floating Categories Menu — mobile only.
 *
 * Sits bottom-right above the MobileBottomNav + StickyCartBar. On tap, opens a
 * bottom sheet listing every category in the restaurant. Tapping a category
 * smooth-scrolls to that section in the menu using the same `#cat-<slug>`
 * anchors the existing horizontal jump-nav uses (defined in
 * `apps/web/src/app/(customer)/menu/menu-client.tsx`). The sticky info bar at
 * the top is 48px tall, so we offset the scroll target by ~120px to keep the
 * category header from sliding under it.
 *
 * Server pages pass a minimal projection of their categories list (no menu
 * items) — the FAB doesn't need anything beyond name + slug + count.
 *
 * Why a sheet instead of just relying on the horizontal pill rail? Long menus
 * (e.g. Mozza Italia has 8+ categories) overflow horizontally and customers
 * miss the ones past the right edge. A vertical sheet shows everything at
 * once and is the standard pattern on Swiggy / Zomato / DoorDash.
 */

import { useEffect, useState } from 'react';
import { LayoutList, X, Clock } from 'lucide-react';

export interface CategoryFabEntry {
  id: string;
  name: string;
  slug: string;
  itemCount: number;
  /** Off-hours categories still appear so the customer knows they exist; we badge them. */
  available: boolean;
  nextOpenLabel?: string | null;
}

export function CategoryFab({ categories }: { categories: CategoryFabEntry[] }) {
  const [open, setOpen] = useState(false);

  // Close on Escape — small accessibility nicety. We don't trap focus or do
  // full a11y theatre here because the sheet is a transient picker, not a
  // form, and Escape is the most common dismiss expectation on mobile
  // keyboards / Bluetooth keyboards.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Lock body scroll so the menu underneath doesn't move while the sheet is
    // visible. Restore on close.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  function jumpTo(slug: string) {
    setOpen(false);
    // Close the sheet first so its body-overflow lock releases, then scroll —
    // otherwise smooth scroll fights the lock in some browsers. rAF queues
    // the scroll after the next paint.
    requestAnimationFrame(() => {
      const el = document.getElementById(`cat-${slug}`);
      if (!el) return;
      // 120px offset clears the sticky info bar (~48px) + the sticky jump-nav
      // pill rail (~52px) plus a small breathing margin.
      const top = el.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  if (categories.length === 0) return null;

  return (
    <>
      {/* FAB pill — bottom-right, ABOVE the bottom nav + sticky cart bar.
          Positioning rationale:
          - bottom nav itself is ~64px, sticky cart bar adds another ~64px when
            visible, so bottom-32 (128px) clears both. We also stack on top of
            the iOS safe-area inset.
          - z-30: below dialogs (z-50) but above page content. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Browse menu categories"
        className="md:hidden fixed right-4 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 ring-1 ring-primary/40 tap-press active:scale-95 transition-transform"
        style={{ bottom: 'calc(8rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <LayoutList className="size-5" />
        <span>Menu</span>
        <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[11px] font-bold leading-none">
          {categories.length}
        </span>
      </button>

      {/* Bottom sheet — slide up on open. Backdrop dismisses; the inner panel
          stops propagation so taps inside don't close. */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Menu categories"
        >
          <div
            className="rounded-t-2xl bg-background shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: 'calc(85vh - env(safe-area-inset-bottom, 0px))' }}
          >
            {/* Drag handle + header */}
            <div className="px-4 pt-3 pb-2">
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    Jump to
                  </div>
                  <h3 className="display text-lg font-semibold">Menu categories</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close categories"
                  className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {/* Scroll area. We pad the bottom by the safe-area inset so the
                last row never collides with the home indicator. */}
            <ul
              className="overflow-y-auto px-2 pb-3"
              style={{
                maxHeight: 'calc(85vh - 7rem - env(safe-area-inset-bottom, 0px))',
                paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
              }}
            >
              {categories.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(c.slug)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left transition-colors tap-press hover:bg-accent active:bg-accent/80"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block font-medium ${c.available ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {c.name}
                      </span>
                      {!c.available && c.nextOpenLabel ? (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-warning">
                          <Clock className="size-3" />
                          {c.nextOpenLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="ml-3 shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {c.itemCount} {c.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
