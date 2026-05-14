'use client';

/**
 * "Order again" CTA shown on the order tracker when the order has been DELIVERED.
 * Calls POST /api/customer/reorder/[orderId], replaces the cart with those items,
 * then routes to /cart.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '../../cart-context';

interface ReorderApiItem {
  menuItemId: string;
  name: string;
  quantity: number;
  // The route returns `price`; tolerate `unitPrice` for forward-compat.
  price?: number;
  unitPrice?: number;
  imageUrl?: string | null;
}

export function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const { add, clear } = useCart();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/customer/reorder/${orderId}`, { method: 'POST' });
      if (!r.ok) {
        toast.error('Could not load this order');
        return;
      }
      const data: { items: ReorderApiItem[]; branchSlug: string } = await r.json();
      if (!data.items?.length) {
        toast.error('Nothing to reorder from this order');
        return;
      }
      clear();
      for (const i of data.items) {
        const unitPrice = Number(i.unitPrice ?? i.price ?? 0);
        add(
          {
            id: i.menuItemId,
            refId: i.menuItemId,
            kind: 'item',
            name: i.name,
            unitPrice,
            imageUrl: i.imageUrl ?? null
          },
          i.quantity
        );
      }
      toast.success('Added to cart');
      router.push('/cart');
    } catch {
      toast.error('Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={onClick} disabled={busy} variant="outline" className="w-full tap-press">
      <RotateCcw className="size-4" />
      {busy ? 'Loading…' : 'Order again'}
    </Button>
  );
}
