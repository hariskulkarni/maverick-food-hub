'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Check, X, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';

export function RestaurantRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  async function call(action: string, body?: object) {
    const r = await fetch(`/api/platform/restaurants/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) return toast.error('Failed: ' + (await r.text()));
    if (r.status === 202) {
      const d = await r.json().catch(() => ({} as any));
      toast.info('Sent for approval', { description: d.summary ?? 'A super-admin must approve this action.' });
      router.refresh();
      return;
    }
    toast.success('Done');
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'PENDING' && (
        <>
          <Button size="sm" onClick={() => call('approve')}><Check className="size-4" /> Approve</Button>
          <Button size="sm" variant="outline" onClick={() => {
            const reason = prompt('Reason for rejection?') ?? undefined;
            call('reject', reason ? { reason } : undefined);
          }}><X className="size-4" /> Reject</Button>
        </>
      )}
      {status === 'ACTIVE' && (
        <Button size="sm" variant="outline" onClick={() => call('suspend')}><Pause className="size-4" /> Suspend</Button>
      )}
      {status === 'SUSPENDED' && (
        <Button size="sm" onClick={() => call('approve')}><Play className="size-4" /> Reactivate</Button>
      )}
    </div>
  );
}
