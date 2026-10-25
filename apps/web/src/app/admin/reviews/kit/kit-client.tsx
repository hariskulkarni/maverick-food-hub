'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Printer, Download, ArrowLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Format = 'tent' | 'insert';
interface Props {
  restaurant: { name: string; logoUrl: string | null; tagline: string | null };
  qr: { code: string; url: string; png: string; scanCount: number };
}

/** Compliant copy: same ask for every guest, no incentive, no pressure. */
export const KIT_COPY = {
  title: 'How was your meal?',
  body: 'Scan to rate your order and, if you like, share a review on Google.',
  footer: 'Good or bad, your honest feedback helps us improve.',
};

const SIZES: Record<Format, { label: string; mm: [number, number]; px: [number, number] }> = {
  tent: { label: 'A5 table tent', mm: [148, 210], px: [1748, 2480] },
  insert: { label: 'A6 packaging insert', mm: [105, 148], px: [1240, 1748] },
};

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

async function renderPng(format: Format, p: Props): Promise<string> {
  const [W, H] = SIZES[format].px;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111111'; ctx.textAlign = 'center';
  const u = W / 100;
  let y = 9 * u;
  if (p.restaurant.logoUrl) {
    try {
      const logo = await loadImg(p.restaurant.logoUrl);
      const s = 16 * u;
      ctx.drawImage(logo, (W - s) / 2, y, s, s);
      y += s + 4 * u;
    } catch { /* cross-origin logo: skip it in the PNG */ }
  }
  ctx.font = `600 ${4.2 * u}px system-ui, sans-serif`;
  ctx.fillStyle = '#666666';
  ctx.fillText(p.restaurant.name.toUpperCase(), W / 2, y + 4 * u);
  y += 13 * u;
  ctx.fillStyle = '#111111';
  ctx.font = `700 ${8.5 * u}px system-ui, sans-serif`;
  ctx.fillText(KIT_COPY.title, W / 2, y);
  y += 7 * u;
  ctx.font = `400 ${4.4 * u}px system-ui, sans-serif`;
  for (const l of wrap(ctx, KIT_COPY.body, 80 * u)) { ctx.fillText(l, W / 2, y); y += 6 * u; }
  const qr = await loadImg(p.qr.png);
  const q = 62 * u;
  y += 3 * u;
  ctx.drawImage(qr, (W - q) / 2, y, q, q);
  y += q + 9 * u;
  ctx.font = `400 ${3.6 * u}px system-ui, sans-serif`;
  ctx.fillStyle = '#555555';
  for (const l of wrap(ctx, KIT_COPY.footer, 80 * u)) { ctx.fillText(l, W / 2, y); y += 5 * u; }
  return c.toDataURL('image/png');
}

export function KitClient(p: Props) {
  const [format, setFormat] = useState<Format>('tent');
  const [busy, setBusy] = useState(false);
  const [w, h] = SIZES[format].mm;

  async function download() {
    setBusy(true);
    try {
      const url = await renderPng(format, p);
      const a = document.createElement('a');
      a.href = url;
      a.download = `review-${format === 'tent' ? 'a5-table-tent' : 'a6-insert'}-${p.qr.code}.png`;
      a.click();
    } catch {
      toast.error('Could not create the PNG');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <style>{`@media print { @page { size: ${w}mm ${h}mm; margin: 0; } body * { visibility: hidden; } #review-kit-sheet, #review-kit-sheet * { visibility: visible; } #review-kit-sheet { position: fixed; inset: 0; margin: 0; border: 0; box-shadow: none; } }`}</style>
      <div className="print:hidden space-y-4">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" asChild><Link href="/admin/settings"><ArrowLeft className="size-4" /> Back</Link></Button>
          <h1 className="display text-2xl font-semibold">Review QR kit</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Put a table tent on tables or an insert in delivery bags. Scans open a page where guests rate their visit and can
          review you on Google. Total scans so far: <b className="tabular-nums">{p.qr.scanCount}</b>.
        </p>
        <p className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          Don&apos;t add offers, discounts or freebies for reviews to this card, and don&apos;t ask guests to review while staff watch.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {(Object.keys(SIZES) as Format[]).map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)} aria-pressed={format === f}
              className={cn('h-10 rounded-full border px-4 text-sm', format === f ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}>
              {SIZES[f].label}
            </button>
          ))}
          <Button size="sm" onClick={() => window.print()} className="w-full sm:ml-auto sm:w-auto"><Printer className="size-4" /> Print</Button>
          <Button size="sm" variant="outline" onClick={download} disabled={busy} className="w-full sm:w-auto"><Download className="size-4" /> Download PNG</Button>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto pb-6 print:mt-0 print:overflow-visible">
        <div
          id="review-kit-sheet"
          className="mx-auto flex flex-col items-center justify-between bg-white p-[8mm] text-center text-black shadow-sm border"
          style={{ width: `${w}mm`, height: `${h}mm` }}
        >
          <div className="flex flex-col items-center">
            {p.restaurant.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.restaurant.logoUrl} alt="" className="mb-2 size-14 rounded-lg object-cover" />
            )}
            <div className="text-xs uppercase tracking-[0.25em] text-zinc-500">{p.restaurant.name}</div>
            <div className={cn('mt-3 font-bold leading-tight', format === 'tent' ? 'text-3xl' : 'text-xl')}>{KIT_COPY.title}</div>
            <p className={cn('mt-2 text-zinc-700', format === 'tent' ? 'text-base' : 'text-sm')}>{KIT_COPY.body}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.qr.png} alt="Review QR code" style={{ width: format === 'tent' ? '85mm' : '60mm', height: format === 'tent' ? '85mm' : '60mm' }} />
          <div>
            <p className="text-xs text-zinc-600">{KIT_COPY.footer}</p>
            <p className="mt-1 break-all text-[9px] text-zinc-400">{p.qr.url}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
