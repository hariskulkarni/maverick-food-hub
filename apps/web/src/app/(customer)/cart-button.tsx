'use client';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useCart } from './cart-context';

export function CartButton() {
  const { count } = useCart();
  return (
    <Link href="/cart" className="relative inline-flex h-9 items-center gap-2 rounded-md bg-secondary px-3 text-sm hover:bg-secondary/80">
      <ShoppingBag className="size-4" />
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {count}
        </span>
      )}
    </Link>
  );
}
