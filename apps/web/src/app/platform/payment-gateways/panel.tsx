'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { IntegrationsSection } from '../../admin/settings/integrations-section';
import { CreditCard, CornerDownRight, Info } from 'lucide-react';

interface Row {
  id: string;
  name: string;
  slug: string;
  status: string;
  parentId: string | null;
  depth: number;
}

export function PaymentGatewaysPanel() {
  const [restaurants, setRestaurants] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/platform/restaurants/picker', { cache: 'no-store' });
      if (r.ok) {
        const { restaurants } = await r.json();
        setRestaurants(restaurants);
        if (restaurants.length > 0) setSelected(restaurants[0].id);
      }
      setLoading(false);
    })();
  }, []);

  const current = useMemo(
    () => restaurants.find((r) => r.id === selected) ?? null,
    [restaurants, selected],
  );
  const parent = useMemo(
    () => (current?.parentId ? restaurants.find((r) => r.id === current.parentId) ?? null : null),
    [restaurants, current],
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-start gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
          <CreditCard className="size-5" />
        </div>
        <div>
          <h1 className="display text-xl">Payment gateways</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure PhonePe or Razorpay for any restaurant on the platform, switch a tenant
            between sandbox and production, and test credentials live before saving.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <label className="text-xs font-medium">Restaurant</label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder={loading ? 'Loading…' : 'Choose a restaurant'} />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className={r.depth > 0 ? 'pl-4 inline-flex items-center gap-1' : ''}>
                    {r.depth > 0 && <CornerDownRight className="size-3 text-muted-foreground" />}
                    {r.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {current && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
              <Badge variant="muted" className="text-[10px]">{current.status}</Badge>
              <span className="font-mono">/{current.slug}</span>
              {parent && <span>· child of {parent.name}</span>}
            </div>
          )}

          {parent && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="size-4 mt-0.5 shrink-0" />
              <div>
                This is a child outlet. If you leave its gateway disconnected it automatically
                transacts on <strong>{parent.name}</strong>’s credentials, and money settles to
                that account. Connect one here only if this outlet needs to settle separately.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && <IntegrationsSection key={selected} restaurantId={selected} />}
    </div>
  );
}
