'use client';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '../cart-context';
import { toast } from 'sonner';

export function ComboAddButton({ id, name, price, imageUrl, branchId }: { id: string; name: string; price: number; imageUrl?: string | null; branchId?: string | null }) {
  const { add } = useCart();
  return (
    // Phone-first: full-width tap target so the button never falls off the
    // card edge when the price block above it wraps to two lines. md+ collapses
    // back to its intrinsic width so the button hugs the row's right edge.
    <Button
      size="sm"
      className="w-full sm:w-auto h-11 sm:h-9"
      onClick={() => {
        add({ id: 'combo:' + id, refId: id, kind: 'combo', branchId, name, unitPrice: price, imageUrl: imageUrl ?? undefined });
        toast.success(`Added "${name}" to cart`);
      }}
    >
      <Plus className="size-4" /> Add combo
    </Button>
  );
}
