'use client';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '../cart-context';
import { toast } from 'sonner';

export function ComboAddButton({ id, name, price, imageUrl, branchId }: { id: string; name: string; price: number; imageUrl?: string | null; branchId?: string | null }) {
  const { add } = useCart();
  return (
    // Phone-first: full-width white "sticker" tap target to MATCH the
    // MenuItemCard ADD button (uppercase, primary border, primary text on
    // background, soft shadow). md+ collapses back to its intrinsic width so
    // the button hugs the row's right edge.
    <Button
      size="sm"
      variant="outline"
      className="tap-press w-full sm:w-auto h-11 sm:h-9 rounded-lg border-2 border-primary bg-background text-primary font-bold uppercase tracking-wider text-xs shadow-sm hover:bg-primary/5"
      onClick={() => {
        add({ id: 'combo:' + id, refId: id, kind: 'combo', branchId, name, unitPrice: price, imageUrl: imageUrl ?? undefined });
        toast.success(`Added "${name}" to cart`);
      }}
    >
      <Plus className="size-4 mr-1" /> Add combo
    </Button>
  );
}
