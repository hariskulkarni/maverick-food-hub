'use client';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/** Re-issue the session cookie (fresh phone flag), then continue to `to`. */
export function RefreshThenGo({ to }: { to: string }) {
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .catch(() => {})
      .finally(() => window.location.replace(to));
  }, [to]);
  return (
    <div className="flex min-h-[50dvh] items-center justify-center gap-2 text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" /> Taking you back…
    </div>
  );
}
