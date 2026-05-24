'use client';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '../cart-context';
import { toast } from 'sonner';

export function ComboAddButton({ id, name, price, imageUrl, branchId }: { id: string; name: string; price: number; imageUrl?: string | null; branchId?: string | null }) {
  const { add } = useCart();
  return (
    <Button
      size="sm"
      onClick={() => {
        add({ id: 'combo:' + id, refId: id, kind: 'combo', branchId, name, unitPrice: price, imageUrl: imageUrl ?? undefined });
        toast.success(`Added "${name}" to cart`);
      }}
    >
      <Plus className="size-4" /> Add combo
    </Button>
  );
}
