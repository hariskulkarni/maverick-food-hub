'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';

export function PlatformRiderActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/platform/rider-applications/${id}/approve`, { method: 'POST' });
        setBusy(false);
        if (!r.ok) return toast.error('Failed: ' + (await r.text()));
        toast.success('Rider approved');
        router.refresh();
      }}><Check className="size-4" /> Approve</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
        const reason = prompt('Reason?') ?? undefined;
        setBusy(true);
        const r = await fetch(`/api/platform/rider-applications/${id}/reject`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
        });
        setBusy(false);
        if (!r.ok) return toast.error('Failed');
        toast.success('Rejected');
        router.refresh();
      }}><X className="size-4" /> Reject</Button>
    </div>
  );
}
