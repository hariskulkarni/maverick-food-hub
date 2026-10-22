'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Check, X, Ban, ShieldCheck, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Req { id: string; restaurantId: string; restaurantName: string; status: string; requestedAt: string }

const STATUS_CLS: Record<string, string> = {
  REQUESTED: 'bg-warning/10 text-warning border-warning/30',
  APPROVED: 'bg-success/10 text-success border-success/30',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/30',
  DISABLED: 'bg-muted text-muted-foreground border-border',
};

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// Flavrly and the self-hosted Flavrly PG gateway run on the same VPS, so the Payment
// Core API is reached over localhost. Pre-fill it so it never has to be typed.
const DEFAULT_BASE_URL = 'http://127.0.0.1:6100';
// One-click into the self-hosted Flavrly PG admin hub (where the Merchant ID + webhook
// secret live). Override per-deployment with NEXT_PUBLIC_YOUPI_ADMIN_URL.
const YOUPI_ADMIN_URL = process.env.NEXT_PUBLIC_YOUPI_ADMIN_URL || 'https://pay-admin.flavrly.in';

export function YoupiAdminClient({
  configured, summary, initialRequests,
}: { configured: boolean; summary: Record<string, unknown> | null; initialRequests: Req[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRequests);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ baseUrl: DEFAULT_BASE_URL, merchantId: '', webhookSecret: '', dailyLimit: '', maxAmountPaise: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { baseUrl: f.baseUrl, merchantId: f.merchantId, webhookSecret: f.webhookSecret };
      if (f.dailyLimit) body.dailyLimit = Number(f.dailyLimit);
      if (f.maxAmountPaise) body.maxAmountPaise = Number(f.maxAmountPaise);
      const res = await fetch('/api/platform/youpi/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || 'Save failed.'); return; }
      toast.success('Flavrly PG connection saved.');
      setF({ baseUrl: DEFAULT_BASE_URL, merchantId: '', webhookSecret: '', dailyLimit: '', maxAmountPaise: '' });
      router.refresh();
    } catch { toast.error('Network error.'); } finally { setSaving(false); }
  }

  async function decide(r: Req, decision: 'APPROVE' | 'REJECT' | 'DISABLE') {
    setBusy(r.id + decision);
    try {
      const res = await fetch(`/api/platform/youpi/${r.restaurantId}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || 'Action failed.'); return; }
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: data.status } : x)));
      toast.success(`${r.restaurantName}: ${String(data.status).toLowerCase()}.`);
    } catch { toast.error('Network error.'); } finally { setBusy(null); }
  }

  const shown = summary ? Object.entries(summary).filter(([, v]) => v !== undefined && v !== null && v !== '') : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="font-semibold">Connection config</h2>
            <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${configured ? STATUS_CLS.APPROVED : STATUS_CLS.REQUESTED}`}>
              {configured ? 'Connected' : 'Not configured'}
            </span>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-2">
            <a
              href={YOUPI_ADMIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              Open Flavrly PG Admin <ExternalLink className="size-3.5" />
            </a>
            <ul className="text-muted-foreground space-y-1 leading-relaxed">
              <li><span className="font-medium text-foreground">Gateway base URL</span> — pre-filled to <code className="font-mono">{DEFAULT_BASE_URL}</code> (same-VPS localhost). Leave as-is unless the gateway moved.</li>
              <li><span className="font-medium text-foreground">Merchant ID</span> — Flavrly PG Admin → <span className="font-medium">Store Settings</span> (the X-Merchant-Id).</li>
              <li><span className="font-medium text-foreground">Webhook secret</span> — Flavrly PG Admin → <span className="font-medium">Developer &amp; Infrastructure Hub → Webhooks &amp; Secrets</span>. Must match exactly.</li>
            </ul>
          </div>
          {shown.length > 0 && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {shown.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                  <dd className="font-mono break-all">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="yp-base">Gateway base URL</Label>
              <Input id="yp-base" type="url" required placeholder={DEFAULT_BASE_URL} value={f.baseUrl} onChange={set('baseUrl')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yp-key">Merchant ID</Label>
              <Input id="yp-key" type="text" required autoComplete="off" placeholder="X-Merchant-Id (UUID)" value={f.merchantId} onChange={set('merchantId')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yp-wh">Webhook secret</Label>
              <Input id="yp-wh" type="password" required autoComplete="off" value={f.webhookSecret} onChange={set('webhookSecret')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yp-daily">Default daily limit (transactions)</Label>
              <Input id="yp-daily" type="number" min={1} value={f.dailyLimit} onChange={set('dailyLimit')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yp-max">Default max amount (paise)</Label>
              <Input id="yp-max" type="number" min={1} value={f.maxAmountPaise} onChange={set('maxAmountPaise')} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : configured ? 'Replace connection' : 'Save connection'}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">Secrets are encrypted and never shown again. Saving replaces the stored connection.</p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Requests queue</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No restaurant has requested Flavrly PG yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.restaurantName}</div>
                    <div className="text-xs text-muted-foreground">Requested {when(r.requestedAt)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLS[r.status] ?? STATUS_CLS.REQUESTED}`}>{r.status}</span>
                    <Button size="sm" disabled={!!busy || r.status === 'APPROVED'} onClick={() => decide(r, 'APPROVE')}>
                      {busy === r.id + 'APPROVE' ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-4 mr-1" />Approve</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!!busy || r.status === 'REJECTED'} onClick={() => decide(r, 'REJECT')}>
                      <X className="size-4 mr-1" />Reject
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" disabled={!!busy || r.status === 'DISABLED'} onClick={() => decide(r, 'DISABLE')}>
                      <Ban className="size-4 mr-1" />Disable
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
