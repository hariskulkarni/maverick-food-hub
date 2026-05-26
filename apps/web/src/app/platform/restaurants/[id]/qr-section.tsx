'use client';
/**
 * QR section — embeddable in the restaurant detail drawer.
 * Lists this restaurant's QR codes and lets the operator mint a new one.
 *
 * QR images are real, scannable PNGs rendered server-side (the API returns a
 * `qrPng` data URL alongside each row); we display them inline and reuse the
 * data URL as the href of a "Download PNG" link.
 */
import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, MousePointerClick, TrendingUp, Download } from 'lucide-react';
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
  /** Customer-facing scan URL the QR encodes (resolved by /qr/[code]). */
  url?: string;
  /** Server-rendered PNG data URL of the scannable QR. */
  qrPng?: string;
};

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
              <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">QR</th>
              <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">Code</th>
              <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">Type</th>
              <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground"><MousePointerClick className="inline size-3" /> Scans</th>
              <th className="text-right px-3 py-2 font-medium text-[11px] uppercase tracking-wider text-muted-foreground"><TrendingUp className="inline size-3" /> CVR</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {qrs.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">No QR codes yet.</td></tr>
            )}
            {qrs.map((q) => {
              const cvr = q.scanCount > 0 ? (q.orderCount / q.scanCount) * 100 : 0;
              return (
                <tr key={q.id}>
                  <td className="px-3 py-2 align-top">
                    {q.qrPng ? (
                      <div className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={q.qrPng}
                          alt={`QR code for ${q.url ?? q.code}`}
                          width={84}
                          height={84}
                          className="rounded border bg-white p-1"
                        />
                        <Button asChild size="sm" variant="outline" className="h-6 px-2 text-[10px]">
                          <a href={q.qrPng} download={`qr-${q.code}.png`}>
                            <Download className="size-3" /> PNG
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
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
