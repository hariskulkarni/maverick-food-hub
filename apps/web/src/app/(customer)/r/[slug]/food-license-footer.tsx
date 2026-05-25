import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

interface Props {
  licenseNumber?: string | null;
  licenseImageUrl?: string | null;
  holder?: string | null;
}

/**
 * Public FSSAI licence footer, shown at the bottom of a restaurant's menu —
 * the same trust signal Swiggy/Zomato display ("Lic. No. …"). Renders nothing
 * when the restaurant hasn't captured a licence number yet. If a scan/photo is
 * on file, the number links out to view it in a new tab so customers can
 * verify it themselves.
 *
 * We intentionally do NOT surface expiry dates publicly — that's operational
 * info for the admin. Customers just see the licence number + an optional copy.
 */
export function FoodLicenseFooter({ licenseNumber, licenseImageUrl, holder }: Props) {
  if (!licenseNumber) return null;

  const label = (
    <span className="font-mono tracking-wide text-foreground/80">{licenseNumber}</span>
  );

  return (
    <section className="border-t bg-muted/30">
      <div className="container py-6">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-muted-foreground/80">
            <ShieldCheck className="size-3.5 text-success" />
            FSSAI Licence
          </span>
          <span className="hidden sm:inline">·</span>
          {licenseImageUrl ? (
            <Link
              href={licenseImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-foreground"
              aria-label={`View FSSAI licence ${licenseNumber}`}
            >
              Lic. No. {label}
              <span className="text-primary underline underline-offset-2">View licence</span>
            </Link>
          ) : (
            <span>Lic. No. {label}</span>
          )}
        </div>
        {holder && (
          <p className="mt-1 text-[11px] text-muted-foreground/70">Licensed to {holder}.</p>
        )}
      </div>
    </section>
  );
}
