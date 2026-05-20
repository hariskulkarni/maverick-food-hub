'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin } from 'lucide-react';

interface InitialState {
  radiusKm: number;
  min: number;
  max: number;
  default: number;
}

export function DiscoveryRadiusClient({ initial }: { initial: InitialState }) {
  const router = useRouter();
  const [radiusKm, setRadiusKm] = useState<number>(initial.radiusKm);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/platform/discovery-radius', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ radiusKm })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { radiusKm: number };
      setRadiusKm(data.radiusKm);
      toast.success(`Discovery radius saved (${data.radiusKm} km).`);
      router.refresh();
    } catch (e) {
      toast.error('Failed to save: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <MapPin className="size-4 text-primary" /> Customer discovery radius
          </h3>
          <p className="text-sm text-muted-foreground max-w-xl">
            Customers only see restaurants with a branch within this distance that also delivers to them.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="max-w-[200px]">
            <Label htmlFor="discoveryRadiusKm">Radius (km)</Label>
            <Input
              id="discoveryRadiusKm"
              type="number"
              min={initial.min}
              max={initial.max}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value) || 0)}
            />
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save radius'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Allowed range: {initial.min}–{initial.max} km · default {initial.default} km.
        </p>
      </CardContent>
    </Card>
  );
}
