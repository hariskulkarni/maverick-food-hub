'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export function DeleteAddressButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!confirm('Delete this address?')) return;
        const r = await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
        if (r.ok) { toast.success('Deleted'); router.refresh(); }
        else toast.error('Failed to delete');
      }}
    >
      <Trash2 className="size-4" /> Remove
    </Button>
  );
}
