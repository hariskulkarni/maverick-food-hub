import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bike } from 'lucide-react';
export const metadata = { title: 'Admin · Riders' };

export default function AdminRidersDeprecated() {
  return (
    <div className="p-6 max-w-2xl">
      <Card><CardContent className="p-6">
        <div className="size-12 grid place-items-center rounded-full bg-primary/10 text-primary mb-3">
          <Bike className="size-6" />
        </div>
        <h1 className="display text-2xl font-semibold">Riders are now platform-managed</h1>
        <p className="mt-3 text-muted-foreground">
          We moved to a marketplace-wide rider pool. Once you mark an order <strong>Ready</strong>,
          any online rider on the platform can claim and deliver it — you don't need to assign anyone manually.
        </p>
        <p className="mt-2 text-muted-foreground">
          The FoodHub platform team handles rider applications, approvals, and per-delivery payouts.
          You'll still see who delivered each order on the order detail page.
        </p>
        <Button className="mt-4" variant="outline" asChild>
          <Link href="/admin/orders">← Back to orders</Link>
        </Button>
      </CardContent></Card>
    </div>
  );
}
