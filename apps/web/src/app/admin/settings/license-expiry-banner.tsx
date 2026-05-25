import { AlertTriangle } from 'lucide-react';
import { licenseStatus, licenseStatusLabel, type LicenseState } from '@/server/food-license';

interface BranchLite {
  name: string;
  fssaiLicenseNumber?: string | null;
  fssaiExpiresOn?: string | Date | null;
}

/**
 * In-app warning banner shown at the top of Admin → Settings whenever any
 * branch's FSSAI licence is expiring within 30 days or already expired. Static
 * server component — it reads the same `licenseStatus` helper the public footer
 * and alert sweep use, so what the admin sees here matches everywhere else.
 */
export function LicenseExpiryBanner({ branches }: { branches: BranchLite[] }) {
  const flagged = branches
    .map((b) => ({
      name: b.name,
      status: licenseStatus(b.fssaiExpiresOn ?? null, Boolean(b.fssaiLicenseNumber))
    }))
    .filter((x) => x.status.needsAttention);

  if (flagged.length === 0) return null;

  // Worst state drives the banner colour: any expired → red, else amber.
  const worst: LicenseState = flagged.some((f) => f.status.state === 'expired') ? 'expired' : 'expiring';
  const tone =
    worst === 'expired'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-warning/40 bg-warning/10 text-warning';

  return (
    <div className={`rounded-xl border p-4 ${tone}`} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            {worst === 'expired'
              ? 'A food licence has expired'
              : 'A food licence is expiring soon'}
          </p>
          <ul className="mt-1 space-y-0.5 text-foreground/80">
            {flagged.map((f) => (
              <li key={f.name}>
                <span className="font-medium text-foreground">{f.name}</span> — {licenseStatusLabel(f.status)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-foreground/70">
            Renew with the FSSAI authority, then update the dates and upload the new copy in the branch&apos;s
            “FSSAI food licence” section below. We also email &amp; SMS this reminder.
          </p>
        </div>
      </div>
    </div>
  );
}
