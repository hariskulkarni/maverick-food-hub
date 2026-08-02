import { BrandMark } from '@/components/brand-mark';

/**
 * Minimal top bar for the STAFF PORTAL (portal.flavrly.in). Replaces the
 * customer <PlatformNav> on the portal surface so staff pages don't carry
 * consumer marketing nav ("How it works", "Become a rider", etc.). Just the
 * brand lockup + a Portal badge, and a quiet link back to the customer site.
 */
export function PortalTopBar() {
  return (
    <div className="container flex h-14 items-center justify-between">
      <span className="inline-flex items-center gap-2">
        <BrandMark className="text-lg" />
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Portal
        </span>
      </span>
      <a
        href="https://flavrly.in"
        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        flavrly.in ↗
      </a>
    </div>
  );
}
