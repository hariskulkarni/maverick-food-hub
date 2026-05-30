'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';

export function ApplicationActions({ id, branches }: { id: string; branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Select value={branchId} onValueChange={setBranchId}>
        <SelectTrigger className="w-44"><SelectValue placeholder="Pick branch" /></SelectTrigger>
        <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" disabled={busy || !branchId} onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/admin/rider-applications/${id}/approve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branchId })
        });
        setBusy(false);
        if (!r.ok) { await reportApiError(r, 'Could not approve rider'); return; }
        toast.success('Rider approved');
        router.refresh();
      }}>
        <Check className="size-4" /> Approve
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
        const reason = prompt('Reason?') ?? undefined;
        setBusy(true);
        const r = await fetch(`/api/admin/rider-applications/${id}/reject`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
        });
        setBusy(false);
        if (!r.ok) return toast.error('Failed');
        toast.success('Rejected');
        router.refresh();
      }}>
        <X className="size-4" /> Reject
      </Button>
    </div>
  );
}
