/**
 * Brand ribbon — renders on a per-cuisine page when that Restaurant belongs to
 * an umbrella Brand. A thin saffron strip that invites the customer to
 * discover the brand's other cuisines. Safe to drop in conditionally: if no
 * brand info is passed (or sibling count <= 0) the component returns null so
 * the parent doesn't need to guard.
 *
 * Server component — no interactivity beyond the <Link>.
 */
import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';

export interface BrandRibbonProps {
  /** Brand slug — used to link to `/brand/<slug>`. */
  brandSlug?: string | null;
  /** Display name of the umbrella brand. */
  brandName?: string | null;
  /** Number of OTHER active cuisines under the brand (not counting current). */
  siblingCount?: number;
}

export function BrandRibbon({ brandSlug, brandName, siblingCount = 0 }: BrandRibbonProps) {
  if (!brandSlug || !brandName) return null;
  // Even if there are no siblings, still show the attribution — it just shifts
  // the CTA to "visit the brand page". The copy below handles both cases.
  const hasSiblings = siblingCount > 0;

  return (
    <Link
      href={`/brand/${brandSlug}`}
      className="block border-b bg-gradient-to-r from-primary/15 via-warning/10 to-primary/15 hover:from-primary/20 hover:via-warning/15 hover:to-primary/20 transition-colors backdrop-blur group"
      aria-label={`Part of ${brandName} — visit umbrella brand page`}
    >
      <div className="container py-3 flex items-center gap-3 text-sm">
        <span className="grid size-8 place-items-center rounded-full bg-primary/20 text-primary shrink-0">
          <Sparkles className="size-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground/90 truncate">
            Part of{' '}
            <span className="font-semibold text-primary">{brandName}</span>
            {hasSiblings && (
              <>
                {' · '}
                <span className="text-foreground/80">
                  explore {siblingCount} sister{' '}
                  {siblingCount === 1 ? 'cuisine' : 'cuisines'}
                </span>
              </>
            )}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary whitespace-nowrap">
          Visit brand
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
