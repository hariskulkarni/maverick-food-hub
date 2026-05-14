'use client';
/**
 * QR section — embeddable in the restaurant detail drawer.
 * Lists this restaurant's QR codes and lets the operator mint a new one.
 *
 * If the optional `qrcode` package were installed we'd render an inline
 * <svg> poster; for now we just show the URL text the operator can
 * paste into any QR generator.
 */
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, MousePointerClick, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { QrType } from '@prisma/client';

type Qr = {
  id: string;
  code: string;
  type: QrType;
  campaignName: string | null;
  scanCount: number;
  orderCount: number;
  isActive: boolean;
};

/** Tiny inline poster — just the URL since no QR lib is available. */
export function qrSvg(text: string): string {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="#fff"/><text x="160" y="160" font-family="monospace" font-size="14" text-anchor="middle" fill="#000">${safe}</text></svg>`;
}

export function QrSection({ restaurantId, initial }: { restaurantId: string; initial: Qr[] }) {
  const [qrs, setQrs] = React.useState<Qr[]>(initial);
  const [busy, setBusy] = React.useState(false);

  async function create(type: QrType, campaignName?: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/platform/restaurants/${restaurantId}/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, campaignName })
      });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      const { qr } = await r.json();
      setQrs((prev) => [qr, ...prev]);
      toast.success('QR created · ' + qr.code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => create('RESTAURANT')}><Plus className="size-4" /> Restaurant</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => create('TAKEAWAY')}><Plus className="size-4" /> Takeaway</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
          const name = prompt('Campaign name?') ?? undefined;
          create('CAMPAIGN', name);
        }}><Plus className="size-4" /> Campaign</Button>
      </div>

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">Code</th>
              <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">Type</th>
              <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground"><MousePointerClick className="inline size-3" /> Scans</th>
              <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground"><TrendingUp className="inline size-3" /> CVR</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {qrs.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground text-xs">No QR codes yet.</td></tr>
            )}
            {qrs.map((q) => {
              const cvr = q.scanCount > 0 ? (q.orderCount / q.scanCount) * 100 : 0;
              return (
                <tr key={q.id}>
                  <td className="px-3 py-2 font-mono text-xs">
                    {q.code}
                    {q.campaignName && <div className="text-[10px] text-muted-foreground">{q.campaignName}</div>}
                  </td>
                  <td className="px-3 py-2"><Badge variant="muted">{q.type}</Badge></td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{q.scanCount}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{cvr.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
