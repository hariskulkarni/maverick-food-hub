'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useCart } from '../cart-context';
import { toast } from 'sonner';

export function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { add, clear } = useCart();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        const r = await fetch(`/api/orders/${orderId}/items`);
        if (!r.ok) return toast.error('Could not load order');
        const items: { id: string; name: string; quantity: number; unitPrice: number; kind: 'item' | 'combo'; refId: string }[] = await r.json();
        clear();
        for (const i of items) add({ id: i.id, refId: i.refId, kind: i.kind, name: i.name, unitPrice: i.unitPrice }, i.quantity);
        toast.success('Cart updated');
        router.push('/cart');
      }}
    >
      Reorder
    </Button>
  );
}
