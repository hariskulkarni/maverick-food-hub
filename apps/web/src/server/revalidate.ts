import { revalidatePath } from 'next/cache';

/**
 * Bust the Next.js Router / Data caches for every surface that renders a
 * restaurant's status, ordering, or identity after a super-admin mutation
 * (approve, suspend, reject, archive, restore, delete, reorder, parent change,
 * identity edit, create).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every /platform page and the public storefront are already `force-dynamic`,
 * so the SERVER never serves a stale render. But the App Router keeps a
 * CLIENT-side Router Cache of prefetched RSC payloads per route. A mutation
 * that only calls `router.refresh()` refreshes the *current* route only —
 * navigating from the restaurant list back to the /platform dashboard (or to
 * the public /restaurants listing) can still show pre-mutation data until a
 * hard reload. That is exactly the "it showed suspended, then fixed itself
 * later" staleness. `revalidatePath` marks these paths stale so the next
 * navigation refetches fresh data.
 *
 * Best-effort: a revalidation hiccup must never fail the mutation itself, so
 * every call is wrapped — the DB write is the source of truth.
 *
 * @param slugs one or more storefront slugs (`/r/<slug>`) touched by the
 *              mutation. Pass the OLD slug on archive/rename so the stale
 *              storefront entry is cleared too. Falsy values are ignored.
 */
export function revalidateRestaurantSurfaces(...slugs: Array<string | null | undefined>) {
  // Platform + public surfaces that list or count restaurants.
  const paths = [
    '/platform',             // dashboard KPI counts (total / pending / suspended)
    '/platform/restaurants', // super-admin list + status chips + groups panel
    '/restaurants',          // public discovery listing
  ];
  for (const p of paths) {
    try { revalidatePath(p); } catch { /* best-effort */ }
  }

  // Per-restaurant storefront pages. De-dupe so a rename that passes old+new
  // (which may coincide) doesn't double-fire.
  for (const slug of new Set(slugs.filter((s): s is string => !!s))) {
    try { revalidatePath(`/r/${slug}`); } catch { /* best-effort */ }
  }
}
