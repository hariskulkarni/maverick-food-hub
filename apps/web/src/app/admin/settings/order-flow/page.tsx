import { Card, CardContent } from '@/components/ui/card';
import { Workflow } from 'lucide-react';
import { requireRestaurant } from '@/server/tenancy';
import { OrderFlowForm } from './order-flow-form';

export const metadata = { title: 'Admin · Order flow' };
export const dynamic = 'force-dynamic';

export default async function OrderFlowSettingsPage() {
  const restaurant = await requireRestaurant();

  const settings = {
    autoAcceptOrders: restaurant.autoAcceptOrders,
    scheduledOrdersEnabled: restaurant.scheduledOrdersEnabled,
    selfPickupEnabled: restaurant.selfPickupEnabled,
    dineInEnabled: restaurant.dineInEnabled,
    reservationDeposit: Number(restaurant.reservationDeposit),
    reservationDiscountPct: restaurant.reservationDiscountPct,
    reservationDurationMin: restaurant.reservationDurationMin,
    allowFreebies: restaurant.allowFreebies
  };

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <header className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Workflow className="size-5" />
        </div>
        <div>
          <h1 className="display text-2xl font-semibold">Order flow</h1>
          <p className="text-sm text-muted-foreground">How orders are accepted, scheduled, picked up, and dined-in.</p>
        </div>
      </header>

      <Card>
        <CardContent className="p-6">
          <OrderFlowForm initial={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
