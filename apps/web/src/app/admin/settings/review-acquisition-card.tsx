'use client';
/**
 * Settings → Reviews → "Review requests" card: post-order Google review asks,
 * the Google review link, and the last-30-day funnel.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Save, Send, MapPin, LifeBuoy, Printer, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { reportApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';

type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL';
interface Config {
  enabled: boolean;
  channels: Channel[];
  delayMinutes: number;
  quietStartHour: number | null;
  quietEndHour: number | null;
  reminderEnabled: boolean;
  reminderAfterHours: number;
  frequencyCapDays: number;
  lowRatingThreshold: number;
  googleReviewUrlOverride: string | null;
  whatsappTemplateName: string | null;
  whatsappTemplateLang: string | null;
  gbpPlaceId: string | null;
  gbpReviewUrl: string | null;
}
interface Resp {
  config: Config;
  googleLink: { url: string | null; source: 'override' | 'gbp' | 'places' | null };
  sources: { gbpConnected: boolean; placesConnected: boolean; placesName: string | null };
  whatsapp: { credentialsConfigured: boolean; templateConfigured: boolean };
  funnel: { sent: number; clicked: number; feedback: number; googleClicks: number; optOuts: number; qrScans: number };
}

const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'SMS', label: 'SMS' },
  { id: 'WHATSAPP', label: 'WhatsApp' },
  { id: 'EMAIL', label: 'Email' },
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const fmtHour = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
const SOURCE_LABEL = { override: 'manual link', gbp: 'Google Business Profile', places: 'Google Places link' } as const;
const selectCls = 'h-10 w-full rounded-md border bg-background px-3 text-sm';

export function ReviewAcquisitionCard({ restaurantId }: { restaurantId?: string } = {}) {
  const qs = restaurantId ? `?restaurantId=${encodeURIComponent(restaurantId)}` : '';
  const [data, setData] = useState<Resp | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/reviews/acquisition${qs}`, { cache: 'no-store' });
    if (!r.ok) return;
    const d: Resp = await r.json();
    setData(d);
    setCfg(d.config);
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  if (!data || !cfg) return <div className="rounded-2xl border bg-muted/20 h-24 shimmer" />;
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg({ ...cfg, [k]: v });
  const toggleChannel = (c: Channel) => {
    const next = cfg.channels.includes(c) ? cfg.channels.filter((x) => x !== c) : [...cfg.channels, c];
    set('channels', CHANNELS.map((x) => x.id).filter((x) => next.includes(x)));
  };
  const quietOn = cfg.quietStartHour != null && cfg.quietEndHour != null;

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/reviews/acquisition${qs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: cfg.enabled,
          channels: cfg.channels,
          delayMinutes: cfg.delayMinutes,
          quietStartHour: cfg.quietStartHour,
          quietEndHour: cfg.quietEndHour,
          reminderEnabled: cfg.reminderEnabled,
          reminderAfterHours: cfg.reminderAfterHours,
          frequencyCapDays: cfg.frequencyCapDays,
          lowRatingThreshold: cfg.lowRatingThreshold,
          googleReviewUrlOverride: cfg.googleReviewUrlOverride ?? '',
          whatsappTemplateName: cfg.whatsappTemplateName ?? '',
          whatsappTemplateLang: cfg.whatsappTemplateLang ?? '',
        }),
      });
      if (!r.ok) { await reportApiError(r, 'Save failed'); return; }
      toast.success('Review request settings saved.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resolveGbp() {
    setResolving(true);
    try {
      const r = await fetch(`/api/admin/reviews/acquisition/resolve-gbp${qs}`, { method: 'POST' });
      if (!r.ok) { await reportApiError(r, 'Could not read Google Business Profile'); return; }
      toast.success('Google review link updated from your Business Profile.');
      await load();
    } finally {
      setResolving(false);
    }
  }

  const f = data.funnel;
  const stats: [string, number][] = [
    ['Asks sent', f.sent], ['Link clicks', f.clicked], ['Feedback', f.feedback],
    ['Google clicks', f.googleClicks], ['Opt-outs', f.optOuts], ['QR scans', f.qrScans],
  ];

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 sm:p-5 space-y-5">
        <div className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Send className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Review requests</div>
            <p className="text-xs text-muted-foreground">Ask every customer, after delivery or pickup, how their order was, with a link to review you on Google.</p>
          </div>
          <Switch checked={cfg.enabled} onCheckedChange={(v) => set('enabled', v)} aria-label="Enable review requests" />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map(([label, n]) => (
            <div key={label} className="rounded-xl border bg-muted/20 p-3">
              <div className="text-lg font-bold tabular-nums">{n}</div>
              <div className="text-[11px] text-muted-foreground">{label} · 30 days</div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Channels (first one the customer can be reached on is used)</Label>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <button key={c.id} type="button" onClick={() => toggleChannel(c.id)} aria-pressed={cfg.channels.includes(c.id)}
                className={cn('h-10 rounded-full border px-4 text-sm transition', cfg.channels.includes(c.id) ? 'border-primary bg-primary/10 text-primary' : 'bg-background text-muted-foreground')}>
                {c.label}
              </button>
            ))}
          </div>
          {cfg.channels.includes('WHATSAPP') && (!data.whatsapp.credentialsConfigured || !cfg.whatsappTemplateName) && (
            <p className="text-xs text-warning">
              WhatsApp needs WhatsApp Cloud API credentials (Settings → Integrations) and an approved Utility template.
              Until both are set, the next channel is used instead.
            </p>
          )}
        </div>

        {cfg.channels.includes('WHATSAPP') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ra-wa-t">WhatsApp template name</Label>
              <Input id="ra-wa-t" value={cfg.whatsappTemplateName ?? ''} placeholder="order_feedback_request" onChange={(e) => set('whatsappTemplateName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ra-wa-l">Template language</Label>
              <Input id="ra-wa-l" value={cfg.whatsappTemplateLang ?? ''} placeholder="en" onChange={(e) => set('whatsappTemplateLang', e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Template body variables, in order: {'{{1}}'} restaurant name, {'{{2}}'} order code, {'{{3}}'} rating link, {'{{4}}'} stop link. No offers or promo text.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ra-delay">Send after delivery / pickup (minutes)</Label>
            <Input id="ra-delay" type="number" min={0} max={10080} value={cfg.delayMinutes} onChange={(e) => set('delayMinutes', Number(e.target.value) || 0)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ra-cap">Ask a customer at most once every (days)</Label>
            <Input id="ra-cap" type="number" min={0} max={365} value={cfg.frequencyCapDays} onChange={(e) => set('frequencyCapDays', Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="ra-quiet">Quiet hours (IST): hold asks until morning</Label>
            <Switch id="ra-quiet" checked={quietOn} onCheckedChange={(v) => setCfg({ ...cfg, quietStartHour: v ? 21 : null, quietEndHour: v ? 9 : null })} />
          </div>
          {quietOn && (
            <div className="grid grid-cols-2 gap-3">
              <select aria-label="Quiet hours start" className={selectCls} value={cfg.quietStartHour ?? 21} onChange={(e) => set('quietStartHour', Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>From {fmtHour(h)}</option>)}
              </select>
              <select aria-label="Quiet hours end" className={selectCls} value={cfg.quietEndHour ?? 9} onChange={(e) => set('quietEndHour', Number(e.target.value))}>
                {HOURS.map((h) => <option key={h} value={h}>Until {fmtHour(h)}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="ra-rem">Send one reminder if the link wasn&apos;t opened</Label>
            <Switch id="ra-rem" checked={cfg.reminderEnabled} onCheckedChange={(v) => set('reminderEnabled', v)} />
          </div>
          {cfg.reminderEnabled && (
            <div className="space-y-1.5 sm:max-w-xs">
              <Label htmlFor="ra-rem-h">Reminder after (hours)</Label>
              <Input id="ra-rem-h" type="number" min={1} max={336} value={cfg.reminderAfterHours} onChange={(e) => set('reminderAfterHours', Number(e.target.value) || 1)} />
            </div>
          )}
        </div>

        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor="ra-low">Open a service-recovery ticket at or below</Label>
          <select id="ra-low" className={selectCls} value={cfg.lowRatingThreshold} onChange={(e) => set('lowRatingThreshold', Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
          </select>
        </div>

        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex items-center gap-2 text-sm font-medium"><MapPin className="size-4" /> Google review link</div>
          {data.googleLink.url ? (
            <p className="break-all text-xs text-muted-foreground">
              {data.googleLink.url} <span className="whitespace-nowrap">(from {SOURCE_LABEL[data.googleLink.source!]})</span>
            </p>
          ) : (
            <p className="text-xs text-warning">No Google link yet. Connect Google Business Profile or Google Places above, or paste your review link below. Until then customers can still rate their order.</p>
          )}
          {data.sources.gbpConnected && (
            <Button size="sm" variant="outline" onClick={resolveGbp} disabled={resolving} className="w-full sm:w-auto">
              {resolving ? 'Reading…' : 'Use my Google Business Profile location'}
            </Button>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="ra-override">Manual review link (overrides the above)</Label>
            <Input id="ra-override" type="url" placeholder="https://g.page/r/…/review" value={cfg.googleReviewUrlOverride ?? ''} onChange={(e) => set('googleReviewUrlOverride', e.target.value)} />
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          Every customer gets the same request and sees the Google button at every rating. Never offer discounts or
          rewards for reviews, and never ask staff to hit review targets. Customers can opt out from any message.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="sm" onClick={save} disabled={busy || cfg.channels.length === 0} className="w-full sm:w-auto">
            <Save className="size-3.5" /> {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/admin/reviews/recovery"><LifeBuoy className="size-3.5" /> Service recovery</Link>
          </Button>
          <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/admin/reviews/kit"><Printer className="size-3.5" /> Print review QR kit</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
