'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Megaphone, Printer, QrCode } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { QrCard } from '@/components/qr-card';
import { StepFrame, Field, apiJson } from '../parts';
import type { StepProps } from '../wizard-client';

export function StorefrontStep({ data, complete, refresh }: StepProps) {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const [qr, setQr] = useState<string | null>(data.qrCode);
  const [busyQr, setBusyQr] = useState(false);
  const ann = data.storefront.announcement;
  const [a, setA] = useState({ enabled: ann.enabled, text: ann.text });
  const [busyPub, setBusyPub] = useState(false);
  const storeUrl = `${origin}/r/${data.restaurant.slug}`;
  const live = data.restaurant.status === 'ACTIVE';

  async function makeQr() {
    setBusyQr(true);
    const res = await apiJson<{ code: string }>('/api/admin/onboarding/qr', 'POST', {}, 'Could not create your QR code');
    setBusyQr(false);
    if (res) { setQr(res.code); refresh(); }
  }

  async function publish() {
    if (a.enabled && !a.text.trim()) { toast.error('Write the announcement text, or switch it off.'); return; }
    setBusyPub(true);
    const res = await apiJson('/api/admin/storefront', 'PATCH', {
      config: { ...data.storefront, announcement: { ...ann, enabled: a.enabled, text: a.text.trim().slice(0, 200) } },
    }, 'Could not publish your storefront');
    setBusyPub(false);
    if (res) { toast.success('Storefront published — changes are live on your page.'); refresh(); }
  }

  return (
    <StepFrame
      title="Storefront & QR"
      intro="Check your public page the way customers see it, add an opening announcement, and get a QR code for your counter, menus and delivery bags."
      why="Orders through your own link and QR come straight to you — and every scan is counted, so you can see which posters and packaging work."
      example={<>Announcement: “<b>Now delivering in Koramangala — free delivery on your first order above ₹299</b>”. Print the QR on table tents and stick it on every delivery bag with “Scan to order direct”.</>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-4 space-y-3">
          <div className="text-sm font-medium">Your storefront</div>
          <p className="font-mono text-xs break-all">{storeUrl}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href={`/r/${data.restaurant.slug}`} target="_blank" rel="noreferrer">Preview page <ExternalLink className="size-3.5" /></a></Button>
            <Button asChild variant="ghost"><Link href="/admin/storefront">Customise layout & banners</Link></Button>
          </div>
          {!live && <p className="text-[11px] text-warning">Your restaurant is {data.restaurant.status.toLowerCase()} — the page becomes visible to customers once Flavrly approves it.</p>}
        </div>

        <div className="rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium"><Megaphone className="size-4 text-primary" /> Opening announcement</div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={a.enabled} onCheckedChange={(v) => setA({ ...a, enabled: v })} /> Show a banner at the top of my page</label>
          {a.enabled && (
            <Field label="Banner text" hint="Keep it under 80 characters.">
              <Input value={a.text} maxLength={200} onChange={(e) => setA({ ...a, text: e.target.value })} placeholder="Now delivering in Koramangala — free delivery on your first order above ₹299" />
            </Field>
          )}
          <Button onClick={publish} disabled={busyPub} variant="outline">{busyPub && <Loader2 className="size-4 animate-spin" />} Publish to my page</Button>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium"><QrCode className="size-4 text-primary" /> Order QR code</div>
        {qr && origin ? (
          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] items-start">
            <QrCard url={`${origin}/qr/${qr}`} label="Scan to order" />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>This code opens your storefront and counts every scan and order it brings in.</p>
              <ul className="list-disc pl-5 text-xs space-y-0.5">
                <li>Print at least 3 × 3 cm so phones can read it from a table.</li>
                <li>Put it on table tents, the billing counter, menus and delivery bags.</li>
              </ul>
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-3.5" /> Print this page</Button>
            </div>
          </div>
        ) : (
          <Button onClick={makeQr} disabled={busyQr}>{busyQr && <Loader2 className="size-4 animate-spin" />} Generate my QR code</Button>
        )}
      </div>

      <div className="flex justify-end"><Button onClick={complete}>Continue</Button></div>
    </StepFrame>
  );
}
