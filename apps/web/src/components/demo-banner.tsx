/**
 * DemoBanner — sticky yellow "DEMO" strip rendered above every page when the
 * runtime is running in demo mode (`DEMO_MODE=true`). Server component, no JS
 * cost on the client. Returns `null` on prod, so the import is safe everywhere.
 */
import { AlertTriangle } from 'lucide-react';
import { isDemoMode } from '@/lib/demo';

export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <div className="sticky top-0 z-50 bg-warning text-warning-foreground border-b border-warning/40 text-xs md:text-sm font-semibold">
      <div className="container py-1.5 flex items-center justify-center gap-2 text-center">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span>
          <strong>Demo environment.</strong> Payments + SMS are simulated. Sample data only — never real customer data.
        </span>
      </div>
    </div>
  );
}
