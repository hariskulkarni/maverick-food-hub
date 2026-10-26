'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Copy, RefreshCw, RotateCcw, Wand2, Download, Link2, Unlink, CheckCircle2, Circle, ExternalLink } from 'lucide-react';

type Health = 'off' | 'not_connected' | 'healthy' | 'degraded' | 'failing';
interface Overview {
  flagEnabled: boolean;
  status: string;
  summary: { baseUrl?: string; clientId?: string; secret?: string; webhookSecret?: string; enabled?: boolean } | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastError: string | null;
  health: Health;
  webhookUrl: string;
  webhookEvents: string[];
  lastWebhook: { at: string; event: string } | null;
  branches: Array<{ id: string; name: string; isActive: boolean; location: { novaryqLocationId: string; currency: string } | null }>;
  counts: Record<string, number>;
  retrying: number;
  restaurantUrl: string | null;
  menuMaster: boolean;
  allowPriceOverride: boolean;
  linkedItems: number;
  manageUrl: string | null;
}
interface SyncRow {
  id: string; orderId: string; state: string; attempts: number; lastError: string | null; lastStatus: string | null;
  novaryqOrderNumber: string | null; updatedAt: string; order: { code: string; status: string; total: number } | null;
}
interface EventRow { id: string; event: string; receivedAt: string; processedAt: string | null; error: string | null; attempts: number }
interface MappingItem { id: string; name: string; category: string; price: number; isAvailable: boolean; linkedCode: string | null }
interface Mapping { items: MappingItem[]; novaryqItems: Array<{ itemCode: string; name: string; price: number | null; available: boolean }>; suggestions: Array<{ menuItemId: string; itemCode: string }> }

const API = '/api/admin/integrations/novaryq';
const HEALTH: Record<Health, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }> = {
  healthy: { label: 'Healthy', variant: 'success' },
  degraded: { label: 'Needs attention', variant: 'warning' },
  failing: { label: 'Failing', variant: 'destructive' },
  off: { label: 'Off', variant: 'muted' },
  not_connected: { label: 'Not connected', variant: 'muted' },
};
const STATE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted' | 'default'> = {
  SENT: 'success', CANCELLED: 'muted', PENDING: 'default', CANCEL_PENDING: 'default', FAILED: 'warning', DEAD: 'destructive',
};
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

interface ApiResult { ok?: boolean; error?: string; detail?: string; itemCount?: number; created?: number; updated?: number; linked?: number }

async function call<T = ApiResult>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T }> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && (data as { ok?: boolean }).ok !== false, data };
}

export function NovaryqPanel() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const r = await call<Overview>(API);
    if (r.ok) setOv(r.data);
    else toast.error((r.data as ApiResult).error ?? 'Could not load the Novaryq settings');
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!ov) return <div className="h-40 rounded-lg border bg-muted/20 shimmer" aria-busy={loading} />;
  const h = HEALTH[ov.health];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={h.variant}>{h.label}</Badge>
        <span className="text-xs text-muted-foreground">
          {ov.counts.SENT ?? 0} sent · {ov.counts.PENDING ?? 0} queued · {ov.counts.FAILED ?? 0} failed · {ov.counts.DEAD ?? 0} gave up
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      {!ov.flagEnabled && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          The Novaryq integration is not switched on for Flavrly yet. You can look around; changes are disabled until the platform team enables it.
        </p>
      )}
      <IndiaSetup ov={ov} onSaved={load} />
      <Credentials ov={ov} onSaved={load} />
      <Webhook ov={ov} />
      <Locations ov={ov} onSaved={load} />
      <ItemMapping branches={ov.branches.filter((b) => b.location)} />
      <SyncLog onChange={load} />
    </div>
  );
}

const copyText = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'), () => toast.error('Copy failed'));

/** "Already on Novaryq India?" — the onboarding path (ADR-FNI-001 §4.2) as a checklist over the sections below. */
function IndiaSetup({ ov, onSaved }: { ov: Overview; onSaved: () => void }) {
  const [allowPrice, setAllowPrice] = useState(ov.allowPriceOverride);
  const [busy, setBusy] = useState(false);
  const steps = [
    { done: ov.status === 'CONNECTED', label: 'Connect your Novaryq India account (API key, INR only)' },
    { done: ov.branches.some((b) => b.location), label: 'Link your branches to Novaryq locations' },
    { done: ov.linkedItems > 0, label: `Import or link your Novaryq menu (${ov.linkedItems} items linked)` },
    { done: !!ov.lastWebhook, label: 'Add the Flavrly webhook in Novaryq and send a test' },
    { done: ov.menuMaster, label: 'Make Novaryq your menu master ("POS: Novaryq")' },
  ];
  const setMaster = async (on: boolean, allowPriceOverride = allowPrice) => {
    setBusy(true);
    const r = await call(`${API}/menu-master`, { method: 'PUT', body: JSON.stringify({ on, allowPriceOverride }) });
    setBusy(false);
    if (r.ok) { toast.success(on ? 'Novaryq is now your menu master' : 'Menu editing is back on Flavrly'); onSaved(); }
    else toast.error(r.data.error ?? 'Failed');
  };
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Already on Novaryq India?</h2>
          <p className="text-xs text-muted-foreground">
            Keep Novaryq for your counter, kitchen and menu; Flavrly takes your online orders and delivers them. Only Novaryq India (INR) accounts can be connected.
          </p>
        </div>
        <ol className="space-y-1.5 text-sm">
          {steps.map((st, i) => (
            <li key={i} className="flex items-start gap-2">
              {st.done ? <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-success" /> : <Circle className="size-4 mt-0.5 shrink-0 text-muted-foreground" />}
              <span className={st.done ? 'text-muted-foreground' : ''}>{st.label}</span>
            </li>
          ))}
        </ol>
        {ov.restaurantUrl && (
          <div className="space-y-1">
            <Label>Your Flavrly restaurant page</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
              <code className="text-xs break-all flex-1 min-w-0">{ov.restaurantUrl}</code>
              <Button variant="outline" size="sm" onClick={() => copyText(ov.restaurantUrl!)} aria-label="Copy Flavrly restaurant URL"><Copy className="size-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste it into Novaryq&apos;s consumer-channel (Flavrly) setting so your Novaryq storefront and online-ordering links send customers here.
            </p>
          </div>
        )}
        <div className="rounded-md border p-3 space-y-2">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={ov.menuMaster} disabled={busy || !ov.flagEnabled} onCheckedChange={(v) => setMaster(!!v)} aria-label="POS: Novaryq" />
            <span><b>POS: Novaryq</b> — names, prices and availability of linked items come from Novaryq and are read-only on Flavrly.</span>
          </label>
          {ov.menuMaster && (
            <label className="flex items-center gap-3 text-xs text-muted-foreground">
              <input type="checkbox" className="size-4" checked={allowPrice} disabled={busy} onChange={(e) => { setAllowPrice(e.target.checked); setMaster(true, e.target.checked); }} />
              Allow Flavrly-only prices for linked items (channel price override). Off by default.
            </label>
          )}
          {ov.manageUrl && (
            <a href={ov.manageUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Manage menu in Novaryq <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Credentials({ ov, onSaved }: { ov: Overview; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(ov.summary?.baseUrl ?? '');
  const [clientId, setClientId] = useState(ov.summary?.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabled, setEnabled] = useState(ov.enabled);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await call(API, { method: 'PUT', body: JSON.stringify({ baseUrl, clientId, secret, webhookSecret, enabled }) });
    setBusy(false);
    if (r.ok) { toast.success(r.data.detail ?? 'Saved'); setSecret(''); setWebhookSecret(''); onSaved(); }
    else toast.error(r.data.error ?? 'Save failed');
  };
  const test = async () => {
    setBusy(true);
    const r = await call(`${API}/test`, { method: 'POST' });
    setBusy(false);
    if (r.ok) toast.success(r.data.detail ?? 'Connected'); else toast.error(r.data.error ?? 'Connection failed');
  };
  const remove = async () => {
    if (!confirm('Disconnect Novaryq? New orders stop being sent to your POS.')) return;
    const r = await call(API, { method: 'DELETE' });
    if (r.ok) { toast.success('Disconnected'); onSaved(); } else toast.error(r.data.error ?? 'Failed');
  };
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Connection</h2>
          <p className="text-xs text-muted-foreground">
            From Novaryq → Developer → API keys, create a key with scopes read:menu, read:orders and write:orders. Secrets are encrypted and never shown again.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="nq-url" label="Novaryq URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://app.novaryq.com" />
          <Field id="nq-key" label="API key (client id)" value={clientId} onChange={setClientId} placeholder="nq_live_…" />
          <Field id="nq-secret" label="API secret" type="password" value={secret} onChange={setSecret} placeholder={ov.summary?.secret ? `Saved (${ov.summary.secret}); leave blank to keep` : 'nqsec_…'} />
          <Field id="nq-whsec" label="Webhook signing secret" type="password" value={webhookSecret} onChange={setWebhookSecret} placeholder={ov.summary?.webhookSecret && ov.summary.webhookSecret !== '(not set)' ? `Saved (${ov.summary.webhookSecret}); leave blank to keep` : 'whsec_… (from the webhook you create below)'} />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Send orders to Novaryq" />
          Send new Flavrly orders to Novaryq (when an order is received)
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy || !ov.flagEnabled}>Test &amp; save</Button>
          <Button variant="outline" onClick={test} disabled={busy || !ov.flagEnabled || ov.status === 'DISCONNECTED'}>Test connection</Button>
          {ov.status !== 'DISCONNECTED' && <Button variant="ghost" onClick={remove} disabled={busy || !ov.flagEnabled}>Disconnect</Button>}
        </div>
        <p className="text-xs text-muted-foreground">
          Status: {ov.status.toLowerCase()} · last tested {when(ov.lastTestedAt)}
          {ov.lastError && <span className="block text-destructive break-words">{ov.lastError}</span>}
        </p>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, value, onChange, type = 'text', placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="space-y-1 min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Webhook({ ov }: { ov: Overview }) {
  const copy = () => copyText(ov.webhookUrl);
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold">Status &amp; menu updates from Novaryq</h2>
        <ol className="list-decimal pl-5 text-sm space-y-1">
          <li>In Novaryq → Developer → Webhooks, add this URL:</li>
        </ol>
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
          <code className="text-xs break-all flex-1 min-w-0">{ov.webhookUrl}</code>
          <Button variant="outline" size="sm" onClick={copy} aria-label="Copy webhook URL"><Copy className="size-4" /></Button>
        </div>
        <ol start={2} className="list-decimal pl-5 text-sm space-y-1">
          <li>Tick the events <span className="font-mono text-xs">{ov.webhookEvents.join(', ')}</span>.</li>
          <li>Copy the signing secret Novaryq shows (whsec_…) into <b>Webhook signing secret</b> above and save.</li>
          <li>Press <b>Send test</b> in Novaryq. It appears here within seconds.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Last webhook received: {ov.lastWebhook ? `${when(ov.lastWebhook.at)} (${ov.lastWebhook.event})` : 'never'}
        </p>
      </CardContent>
    </Card>
  );
}

function Locations({ ov, onSaved }: { ov: Overview; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(ov.branches.map((b) => [b.id, b.location?.novaryqLocationId ?? ''])),
  );
  const save = async (branchId: string) => {
    const r = await call(`${API}/locations`, { method: 'PUT', body: JSON.stringify({ branchId, novaryqLocationId: draft[branchId] ?? '' }) });
    if (r.ok) { toast.success(`Linked (${r.data.itemCount} Novaryq items, INR)`); onSaved(); } else toast.error(r.data.error ?? 'Failed');
  };
  const remove = async (branchId: string) => {
    const r = await call(`${API}/locations?branchId=${encodeURIComponent(branchId)}`, { method: 'DELETE' });
    if (r.ok) { toast.success('Unlinked'); onSaved(); } else toast.error(r.data.error ?? 'Failed');
  };
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <div>
          <h2 className="font-semibold">Branches → Novaryq locations</h2>
          <p className="text-xs text-muted-foreground">Only linked branches send orders. The Novaryq location must sell in INR.</p>
        </div>
        <ul className="divide-y divide-border">
          {ov.branches.map((b) => (
            <li key={b.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="sm:w-48 min-w-0">
                <div className="font-medium text-sm truncate">{b.name}</div>
                {b.location ? <Badge variant="success">Linked · {b.location.currency}</Badge> : <Badge variant="muted">Not linked</Badge>}
              </div>
              <Input
                className="sm:flex-1"
                aria-label={`Novaryq location id for ${b.name}`}
                placeholder="Novaryq location id, e.g. loc_…"
                value={draft[b.id] ?? ''}
                onChange={(e) => setDraft({ ...draft, [b.id]: e.target.value })}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => save(b.id)} disabled={!ov.flagEnabled || !draft[b.id]}>Save</Button>
                {b.location && <Button size="sm" variant="ghost" onClick={() => remove(b.id)} disabled={!ov.flagEnabled}>Unlink</Button>}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ItemMapping({ branches }: { branches: Overview['branches'] }) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [data, setData] = useState<Mapping | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!branchId) return;
    setBusy(true);
    const r = await call<Mapping>(`${API}/items?branchId=${encodeURIComponent(branchId)}`);
    setBusy(false);
    if (r.ok) setData(r.data); else { setData(null); toast.error((r.data as ApiResult).error ?? 'Could not load the Novaryq menu'); }
  }, [branchId]);
  useEffect(() => { load(); }, [load]);
  const suggested = useMemo(() => new Map((data?.suggestions ?? []).map((s) => [s.menuItemId, s.itemCode])), [data]);
  const rows = (data?.items ?? []).filter((i) => !q || `${i.name} ${i.category} ${i.linkedCode ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const link = async (menuItemId: string, itemCode: string | null) => {
    const r = await call(`${API}/items`, { method: 'PUT', body: JSON.stringify({ menuItemId, itemCode }) });
    if (r.ok) load(); else toast.error(r.data.error ?? 'Failed');
  };
  const post = async (path: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    const r = await call(`${API}/${path}`, { method: 'POST', body: JSON.stringify({ branchId }) });
    setBusy(false);
    if (r.ok) { toast.success(path === 'import' ? `Imported: ${r.data.created} new, ${r.data.updated} updated, ${r.data.linked} linked` : `Linked ${r.data.linked} items`); load(); }
    else toast.error(r.data.error ?? 'Failed');
  };

  if (branches.length === 0) return null;
  const unmapped = (data?.items ?? []).filter((i) => !i.linkedCode).length;
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <div>
          <h2 className="font-semibold">Menu items ↔ Novaryq items</h2>
          <p className="text-xs text-muted-foreground">
            Orders containing an unlinked item are not sent to the POS. {data && `${unmapped} of ${data.items.length} items unlinked.`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="Branch" className="h-10 rounded-md border border-input bg-background px-3 text-sm sm:w-56" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <Input className="sm:flex-1" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => post('items/auto-match')} disabled={busy || !data?.suggestions.length}>
            <Wand2 className="size-4" /> Auto-match by name ({data?.suggestions.length ?? 0})
          </Button>
          <Button size="sm" variant="outline" onClick={() => post('import', 'Import the Novaryq menu into this branch? Items are created or updated (matched by category + name) and linked.')} disabled={busy}>
            <Download className="size-4" /> Import Novaryq menu
          </Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Flavrly item</th><th className="p-2">Novaryq item</th><th className="p-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="p-2 align-top">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{i.category} · ₹{i.price.toFixed(2)}{i.isAvailable ? '' : ' · unavailable'}</div>
                  </td>
                  <td className="p-2 align-top">
                    <select
                      aria-label={`Novaryq item for ${i.name}`}
                      className="h-9 w-full min-w-40 rounded-md border border-input bg-background px-2 text-sm"
                      value={i.linkedCode ?? ''}
                      onChange={(e) => link(i.id, e.target.value || null)}
                    >
                      <option value="">— not linked —</option>
                      {(data?.novaryqItems ?? []).map((n) => <option key={n.itemCode} value={n.itemCode}>{n.name} ({n.itemCode})</option>)}
                      {i.linkedCode && !(data?.novaryqItems ?? []).some((n) => n.itemCode === i.linkedCode) && <option value={i.linkedCode}>{i.linkedCode} (not in Novaryq menu)</option>}
                    </select>
                    {!i.linkedCode && suggested.has(i.id) && <div className="text-xs text-muted-foreground mt-1">Suggested: {suggested.get(i.id)}</div>}
                  </td>
                  <td className="p-2 align-top text-right">
                    {i.linkedCode ? (
                      <Button size="sm" variant="ghost" onClick={() => link(i.id, null)} aria-label={`Unlink ${i.name}`}><Unlink className="size-4" /></Button>
                    ) : suggested.has(i.id) ? (
                      <Button size="sm" variant="ghost" onClick={() => link(i.id, suggested.get(i.id)!)} aria-label={`Link ${i.name}`}><Link2 className="size-4" /></Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">{busy ? 'Loading…' : 'No items'}</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SyncLog({ onChange }: { onChange: () => void }) {
  const [state, setState] = useState('');
  const [data, setData] = useState<{ syncs: SyncRow[]; events: EventRow[] } | null>(null);
  const load = useCallback(async () => {
    const r = await call<{ syncs: SyncRow[]; events: EventRow[] }>(`${API}/syncs${state ? `?state=${state}` : ''}`);
    if (r.ok) setData(r.data);
  }, [state]);
  useEffect(() => { load(); }, [load]);
  const replay = async (id: string) => {
    const r = await call(`${API}/syncs/${encodeURIComponent(id)}/replay`, { method: 'POST' });
    if (r.ok) { toast.success('Queued again'); load(); onChange(); } else toast.error(r.data.error ?? 'Failed');
  };
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <h2 className="font-semibold">Sync log</h2>
        <div className="flex flex-wrap gap-2">
          {['', 'FAILED', 'DEAD', 'PENDING', 'SENT', 'CANCEL_PENDING', 'CANCELLED'].map((s) => (
            <Button key={s || 'all'} size="sm" variant={state === s ? 'default' : 'outline'} onClick={() => setState(s)}>
              {s ? s.replace('_', ' ').toLowerCase() : 'all'}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Order</th><th className="p-2">Sync</th><th className="p-2">POS</th><th className="p-2">Detail</th><th className="p-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(data?.syncs ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="p-2 align-top whitespace-nowrap">{s.order?.code ?? s.orderId}<div className="text-xs text-muted-foreground">{s.order?.status.toLowerCase().replace(/_/g, ' ')}</div></td>
                  <td className="p-2 align-top"><Badge variant={STATE_VARIANT[s.state] ?? 'default'}>{s.state.replace('_', ' ')}</Badge><div className="text-xs text-muted-foreground">{s.attempts} tries · {when(s.updatedAt)}</div></td>
                  <td className="p-2 align-top text-xs">{s.novaryqOrderNumber ? `#${s.novaryqOrderNumber}` : '—'}{s.lastStatus ? ` · ${s.lastStatus}` : ''}</td>
                  <td className="p-2 align-top text-xs text-muted-foreground break-words max-w-xs">{s.lastError ?? ''}</td>
                  <td className="p-2 align-top text-right">
                    {(s.state === 'FAILED' || s.state === 'DEAD') && (
                      <Button size="sm" variant="outline" onClick={() => replay(s.id)}><RotateCcw className="size-4" /> Replay</Button>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.syncs.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Nothing here yet</td></tr>}
            </tbody>
          </table>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Updates received from Novaryq ({data?.events.length ?? 0})</summary>
          <ul className="mt-2 divide-y divide-border text-xs">
            {(data?.events ?? []).map((e) => (
              <li key={e.id} className="py-1.5 flex flex-wrap gap-x-3">
                <span className="font-mono">{e.event}</span>
                <span className="text-muted-foreground">{when(e.receivedAt)}</span>
                <span className={e.error?.startsWith('dead') ? 'text-destructive' : 'text-muted-foreground'}>
                  {e.processedAt ? e.error ?? 'applied' : `pending (${e.attempts} tries)${e.error ? `: ${e.error}` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
