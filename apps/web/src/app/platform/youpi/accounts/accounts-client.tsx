'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface Account {
  id: string;
  restaurantId: string;
  restaurantName: string;
  gatewayMerchantId: string;
  vpa: string;
  legalEntityName: string;
  ifsc: string | null;
  accountLast4: string | null;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'SUSPENDED' | 'REVOKED';
  verificationMethod: string | null;
  verifiedAt: string | null;
  verifiedById: string | null;
  disabledForNewAt: string | null;
  createdById: string | null;
  createdAt: string;
}
interface PendingVpa { restaurantId: string; restaurantName: string; pendingReceivingVpa: string; requestedAt: string | null; currentReceivingVpa: string | null }
type Action = 'VERIFY' | 'SUSPEND' | 'DISABLE_NEW' | 'ENABLE_NEW' | 'REVOKE';

const STATUS_VARIANT = { PENDING_VERIFICATION: 'warning', VERIFIED: 'success', SUSPENDED: 'muted', REVOKED: 'destructive' } as const;
const METHODS = ['Penny-drop / bank letter', 'Cancelled cheque + KYC', 'Gateway admin readback', 'Video call with owner'];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm';

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: { error?: string } }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function allowed(a: Account): Action[] {
  switch (a.status) {
    case 'PENDING_VERIFICATION': return ['VERIFY', 'SUSPEND', 'REVOKE'];
    case 'VERIFIED': return [a.disabledForNewAt ? 'ENABLE_NEW' : 'DISABLE_NEW', 'SUSPEND', 'REVOKE'];
    case 'SUSPENDED': return ['VERIFY', 'REVOKE'];
    default: return [];
  }
}
const LABEL: Record<Action, string> = {
  VERIFY: 'Verify', SUSPEND: 'Suspend', DISABLE_NEW: 'Disable new payments', ENABLE_NEW: 'Re-enable new payments', REVOKE: 'Revoke',
};

export function AccountsClient({ currentUserId, restaurants, pendingVpa, accounts }: {
  currentUserId: string;
  restaurants: { id: string; name: string; featureStatus: string }[];
  pendingVpa: PendingVpa[];
  accounts: Account[];
}) {
  const router = useRouter();
  const empty = { restaurantId: '', gatewayMerchantId: '', vpa: '', legalEntityName: '', ifsc: '', accountNumber: '' };
  const [f, setF] = useState(empty);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<{ id: string; action: Action } | null>(null);
  const [act, setAct] = useState({ method: METHODS[0], note: '', reason: '' });
  const [actErr, setActErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCreateErr(null);
    try {
      const { ok, data } = await postJson('/api/platform/youpi/accounts', f);
      if (!ok) { setCreateErr(data.error || 'Could not register the account.'); return; }
      toast.success('Account registered. Another super admin must verify it.');
      setF(empty);
      router.refresh();
    } catch { setCreateErr('Network error.'); } finally { setSaving(false); }
  }

  async function submitAction(a: Account, action: Action) {
    setBusy(true);
    setActErr(null);
    try {
      const body = action === 'VERIFY' ? { action, method: act.method, note: act.note } : { action, reason: act.reason };
      const { ok, data } = await postJson(`/api/platform/youpi/accounts/${a.id}`, body);
      if (!ok) { setActErr(data.error || 'Action failed.'); return; }
      toast.success(`${a.restaurantName}: ${LABEL[action].toLowerCase()} done.`);
      setOpen(null);
      setAct({ method: METHODS[0], note: '', reason: '' });
      router.refresh();
    } catch { setActErr('Network error.'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {pendingVpa.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-6 space-y-3">
            <h2 className="font-semibold">UPI ID change requests from restaurants</h2>
            <p className="text-xs text-muted-foreground">These have no effect until you register and another super admin verifies an account with the new UPI ID.</p>
            <ul className="divide-y divide-border">
              {pendingVpa.map((p) => (
                <li key={p.restaurantId} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{p.restaurantName}</div>
                    <div className="text-xs text-muted-foreground break-all">
                      Current: {p.currentReceivingVpa ?? '—'} → Requested: <span className="font-mono">{p.pendingReceivingVpa}</span> · {when(p.requestedAt)}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setF({ ...empty, restaurantId: p.restaurantId, vpa: p.pendingReceivingVpa })}>
                    Start onboarding
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Plus className="size-4" /> Register a receiving account</h2>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ra-rest">Restaurant</Label>
              <select id="ra-rest" required className={selectCls} value={f.restaurantId} onChange={set('restaurantId')}>
                <option value="">Choose a restaurant…</option>
                {restaurants.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.featureStatus.toLowerCase()})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-mid">Gateway merchant id</Label>
              <Input id="ra-mid" required autoComplete="off" value={f.gatewayMerchantId} onChange={set('gatewayMerchantId')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-vpa">Receiving UPI ID (VPA)</Label>
              <Input id="ra-vpa" required autoComplete="off" placeholder="shop@bank" value={f.vpa} onChange={set('vpa')} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ra-legal">Legal entity name (as on the bank account)</Label>
              <Input id="ra-legal" required value={f.legalEntityName} onChange={set('legalEntityName')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-ifsc">IFSC</Label>
              <Input id="ra-ifsc" required autoComplete="off" placeholder="ABCD0123456" value={f.ifsc} onChange={set('ifsc')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ra-acct">Bank account number</Label>
              <Input id="ra-acct" required autoComplete="off" inputMode="numeric" value={f.accountNumber} onChange={set('accountNumber')} />
              <p className="text-xs text-muted-foreground">Used only to compute a fingerprint; never stored or shown again.</p>
            </div>
            {createErr && <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{createErr}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : 'Register (pending verification)'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold">Accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No receiving accounts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((a) => (
                <li key={a.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <div className="font-medium">{a.restaurantName}</div>
                      <div className="text-xs text-muted-foreground break-all">
                        <span className="font-mono">{a.vpa}</span> · merchant <span className="font-mono">{a.gatewayMerchantId}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.legalEntityName} · {a.ifsc ?? '—'} · A/c ••••{a.accountLast4 ?? '—'} · registered {when(a.createdAt)}
                        {a.verifiedAt && <> · verified {when(a.verifiedAt)} ({a.verificationMethod})</>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[a.status]}>{a.status.replace('_', ' ')}</Badge>
                      {a.disabledForNewAt && a.status === 'VERIFIED' && <Badge variant="warning">New payments off</Badge>}
                      {allowed(a).map((action) => (
                        <Button key={action} size="sm" variant={action === 'VERIFY' ? 'default' : 'outline'}
                          disabled={action === 'VERIFY' && a.createdById === currentUserId}
                          title={action === 'VERIFY' && a.createdById === currentUserId ? 'A different super admin must verify an account you registered' : undefined}
                          onClick={() => { setOpen({ id: a.id, action }); setActErr(null); }}>
                          {LABEL[action]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {open?.id === a.id && (
                    <div className="rounded-lg border bg-muted/40 p-3 grid gap-2 sm:grid-cols-2">
                      {open.action === 'VERIFY' ? (
                        <>
                          <div className="space-y-1">
                            <Label htmlFor={`m-${a.id}`}>Verification method</Label>
                            <select id={`m-${a.id}`} className={selectCls} value={act.method} onChange={(e) => setAct({ ...act, method: e.target.value })}>
                              {METHODS.map((m) => <option key={m}>{m}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1 sm:col-span-2">
                            <Label htmlFor={`n-${a.id}`}>What you checked</Label>
                            <Textarea id={`n-${a.id}`} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} />
                          </div>
                        </>
                      ) : (
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor={`r-${a.id}`}>Reason</Label>
                          <Textarea id={`r-${a.id}`} value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} />
                          <p className="text-xs text-muted-foreground">Blocks new checkouts only. In-flight payments keep reconciling.</p>
                        </div>
                      )}
                      {actErr && <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{actErr}</p>}
                      <div className="sm:col-span-2 flex gap-2">
                        <Button size="sm" disabled={busy} onClick={() => submitAction(a, open.action)}>
                          {busy ? <Loader2 className="size-4 animate-spin" /> : `Confirm: ${LABEL[open.action]}`}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
