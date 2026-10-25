'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { reportApiError } from '@/lib/api-error';

export function DismissChecklistButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="ghost" size="sm" disabled={busy} onClick={async () => {
      setBusy(true);
      const r = await fetch('/api/admin/onboarding/dismiss', { method: 'POST' }).catch(() => null);
      setBusy(false);
      if (r && r.ok) router.refresh();
      else if (r) await reportApiError(r, 'Could not hide the checklist');
    }}>
      Dismiss
    </Button>
  );
}
