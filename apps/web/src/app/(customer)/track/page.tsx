'use client';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function TrackPage() {
  const [code, setCode] = useState('');
  const router = useRouter();
  return (
    <div className="container py-12 max-w-md">
      <h1 className="display text-2xl font-semibold mb-2">Track your order</h1>
      <p className="text-sm text-muted-foreground mb-4">Enter your order code (e.g. ORD-AB12CD) to see live status.</p>
      <Card>
        <CardContent className="p-5">
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await fetch(`/api/orders/lookup?code=${encodeURIComponent(code.toUpperCase().trim())}`);
              if (!r.ok) return toast.error('Order not found');
              const j = await r.json();
              router.push(`/orders/${j.id}`);
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ORD-XXXXXX" />
            <Button><Search className="size-4" /> Track</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
