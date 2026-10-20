'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Check, X, Ban, ShieldCheck } from 'lucide-react';
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

export function YoupiAdminClient({
  configured, summary, initialRequests,
}: { configured: boolean; summary: Record<string, unknown> | null; initialRequests: Req[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRequests);
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ baseUrl: '', apiKey: '', webhookSecret: '', dailyLimit: '', maxAmountPaise: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { baseUrl: f.baseUrl, apiKey: f.apiKey, webhookSecret: f.webhookSecret };
      if (f.dailyLimit) body.dailyLimit = Number(f.dailyLimit);
      if (f.maxAmountPaise) body.maxAmountPaise = Number(f.maxAmountPaise);
      const res = await fetch('/api/platform/youpi/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || 'Save failed.'); return; }
      toast.success('YouPI connection saved.');
      setF({ baseUrl: '', apiKey: '', webhookSecret: '', dailyLimit: '', maxAmountPaise: '' });
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
              <Input id="yp-base" type="url" required placeholder="https://pg.example.com" value={f.baseUrl} onChange={set('baseUrl')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yp-key">API key</Label>
              <Input id="yp-key" type="password" required autoComplete="off" value={f.apiKey} onChange={set('apiKey')} />
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
            <p className="text-sm text-muted-foreground">No restaurant has requested YouPI yet.</p>
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
