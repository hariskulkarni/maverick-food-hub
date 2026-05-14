'use client';
/**
 * Reusable QR + URL display.
 *
 * Renders a scannable QR code for `url` and the URL in monospace with a
 * "Copy URL" button (2s success confirmation). Used on the post-signup success
 * screen and the super-admin restaurant approval drawer.
 *
 * QR generation: lazily import the `qrcode` package on the client and ask it for
 * an inline-SVG string. If the import fails for any reason we fall back to the
 * deprecated-but-functional Google Charts QR endpoint as an <img>. Keeping this
 * fallback means the UI never shows an empty box even if a future build drops
 * the `qrcode` dep.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';

export interface QrCardProps {
  url: string;
  label?: string;
  size?: number;
}

export function QrCard({ url, label, size = 192 }: QrCardProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFallback(false);
    if (!url) return;
    (async () => {
      try {
        const mod: any = await import('qrcode');
        const out: string = await mod.toString(url, { type: 'svg', margin: 1, width: size });
        if (!cancelled) setSvg(out);
      } catch {
        if (!cancelled) setFallback(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent — the URL is still visible on-screen.
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        {label && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">{label}</div>
        )}
        <div
          className="mx-auto grid place-items-center rounded-lg border bg-white p-2"
          style={{ width: size + 16, height: size + 16 }}
        >
          {svg ? (
            <div
              aria-label={`QR code for ${url}`}
              style={{ width: size, height: size }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : fallback ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(url)}`}
              alt={`QR code for ${url}`}
              width={size}
              height={size}
            />
          ) : (
            <div className="text-xs text-muted-foreground">Generating…</div>
          )}
        </div>
        <div className="font-mono text-[11px] break-all rounded-md border bg-muted/40 p-2">{url}</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copy}
          disabled={!url}
          className="w-full"
          aria-label={`Copy ${label ?? 'URL'}`}
        >
          {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy URL</>}
        </Button>
      </CardContent>
    </Card>
  );
}
