'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, RefreshCw } from 'lucide-react';

export function SettlementControls({
  restaurants, restaurantId, from, to,
}: {
  restaurants: { id: string; name: string }[];
  restaurantId: string; from: string; to: string;
}) {
  const router = useRouter();
  const [rid, setRid] = useState(restaurantId);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const qs = (r = rid, fr = f, tt = t) => `restaurantId=${encodeURIComponent(r)}&from=${fr}&to=${tt}`;
  function go() { router.push(`/platform/settlements?${qs()}`); }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Restaurant</label>
        <select value={rid} onChange={(e) => setRid(e.target.value)}
          className="mt-1 h-9 w-[240px] rounded-md border bg-background px-2 text-sm">
          {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">From</label>
        <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="h-9 mt-1 w-[150px]" />
      </div>
      <div>
        <label className="text-[11px] uppercase tracking-wider text-muted-foreground">To</label>
        <Input type="date" value={t} onChange={(e) => setT(e.target.value)} className="h-9 mt-1 w-[150px]" />
      </div>
      <Button onClick={go} size="sm"><RefreshCw className="size-4" /> Generate</Button>
      <a href={`/api/platform/settlements/export?${qs()}`}>
        <Button variant="outline" size="sm" type="button"><Download className="size-4" /> Export Excel</Button>
      </a>
    </div>
  );
}
