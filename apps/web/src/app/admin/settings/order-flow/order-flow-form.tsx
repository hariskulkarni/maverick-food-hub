'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

interface OrderFlowSettings {
  autoAcceptOrders: boolean;
  scheduledOrdersEnabled: boolean;
  selfPickupEnabled: boolean;
  dineInEnabled: boolean;
  reservationDeposit: number;
  reservationDiscountPct: number;
  reservationDurationMin: number;
}

export function OrderFlowForm({ initial }: { initial: OrderFlowSettings }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof OrderFlowSettings>(k: K, v: OrderFlowSettings[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/settings/order-flow', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoAcceptOrders: f.autoAcceptOrders,
          scheduledOrdersEnabled: f.scheduledOrdersEnabled,
          selfPickupEnabled: f.selfPickupEnabled,
          dineInEnabled: f.dineInEnabled,
          reservationDeposit: f.reservationDeposit,
          reservationDiscountPct: f.reservationDiscountPct,
          reservationDurationMin: f.reservationDurationMin
        })
      });
      if (!r.ok) return toast.error('Save failed: ' + (await r.text()));
      toast.success('Order-flow settings saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <ToggleRow
        label="Auto-accept orders"
        hint="New orders are accepted automatically without manual confirmation."
        checked={f.autoAcceptOrders}
        onChange={(v) => set('autoAcceptOrders', v)}
      />
      <Separator />
      <ToggleRow
        label="Allow scheduled orders"
        hint="Customers can place orders for a later time slot."
        checked={f.scheduledOrdersEnabled}
        onChange={(v) => set('scheduledOrdersEnabled', v)}
      />
      <Separator />
      <ToggleRow
        label="Allow self-pickup"
        hint="Customers can collect their order from the counter instead of delivery."
        checked={f.selfPickupEnabled}
        onChange={(v) => set('selfPickupEnabled', v)}
      />
      <Separator />
      <ToggleRow
        label="Dine-in reservations"
        hint="Let customers reserve a table. Configure deposit, discount, and slot length below."
        checked={f.dineInEnabled}
        onChange={(v) => set('dineInEnabled', v)}
      />

      {f.dineInEnabled && (
        <div className="mt-4 grid gap-4 rounded-lg border bg-muted/40 p-4 sm:grid-cols-3">
          <Field label="Deposit (₹)">
            <Input
              type="number"
              min={0}
              step="1"
              value={f.reservationDeposit}
              onChange={(e) => set('reservationDeposit', Number(e.target.value))}
            />
          </Field>
          <Field label="Discount (%)">
            <Input
              type="number"
              min={0}
              max={100}
              step="1"
              value={f.reservationDiscountPct}
              onChange={(e) => set('reservationDiscountPct', Number(e.target.value))}
            />
          </Field>
          <Field label="Default slot (min)">
            <Input
              type="number"
              min={15}
              max={600}
              step="5"
              value={f.reservationDurationMin}
              onChange={(e) => set('reservationDurationMin', Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      <div className="flex justify-end pt-4">
        <Button onClick={save} disabled={busy}>
          <Save className="size-4" /> {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
