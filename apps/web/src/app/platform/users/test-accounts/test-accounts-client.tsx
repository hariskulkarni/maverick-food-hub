'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bike, Loader2, ShoppingBag, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Role = 'CUSTOMER' | 'RIDER';
interface TestAccount {
  id: string;
  phone: string | null;
  name: string | null;
  role: string;
  createdAt: string;
  deletedAt: string | null;
  suspendedAt: string | null;
}

type Pending = { kind: 'create'; phone: string; role: Role; name: string } | { kind: 'delete'; phone: string; role: string };

const API = '/api/platform/users/test-accounts';

async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(API, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, data };
}

function roleLabel(role: string) {
  return role === 'RIDER' ? 'Rider' : 'Customer';
}

export function TestAccountsClient() {
  const [accounts, setAccounts] = useState<TestAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('RIDER');
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call('GET');
    if (!r.ok) { setLoadError(r.data?.error ?? 'Could not load test accounts.'); return; }
    setLoadError(null);
    setAccounts(r.data.accounts as TestAccount[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const phoneValid = /^[6-9]\d{9}$/.test(digits);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const r = pending.kind === 'create'
      ? await call('POST', { phone: pending.phone, role: pending.role, name: pending.name || undefined })
      : await call('DELETE', { phone: pending.phone });
    setBusy(false);
    setPending(null);
    if (!r.ok) { toast.error(r.data?.error ?? 'Request failed.'); return; }
    toast.success(r.data?.message ?? 'Done.');
    if (pending.kind === 'create') { setPhone(''); setName(''); }
    void load();
  }

  const active = (accounts ?? []).filter((a) => !a.deletedAt);
  const removed = (accounts ?? []).filter((a) => a.deletedAt);

  return (
    <div className="space-y-5">
      <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
        <AlertTriangle className="size-5 shrink-0 mt-0.5" aria-hidden />
        <p className="text-sm">
          <strong>Anyone who knows a test account&apos;s phone number can sign in as it</strong> — the login code is shown on
          screen. Use numbers nobody uses or can guess, and delete every test account before launch.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><UserPlus className="size-4" /> Create a test account</h2>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Account type</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['RIDER', 'CUSTOMER'] as Role[]).map((r) => (
                <label
                  key={r}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${role === r ? 'border-primary bg-primary/5 font-medium' : 'border-border'}`}
                >
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="accent-primary" />
                  {r === 'RIDER' ? <Bike className="size-4" aria-hidden /> : <ShoppingBag className="size-4" aria-hidden />}
                  {roleLabel(r)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="ta-phone">Mobile number</Label>
            <div className="flex items-stretch rounded-md border focus-within:ring-2 focus-within:ring-ring">
              <span className="flex items-center px-3 text-sm text-muted-foreground border-r">+91</span>
              <Input
                id="ta-phone"
                inputMode="numeric"
                autoComplete="off"
                placeholder="9XXXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="border-0 focus-visible:ring-0 min-h-11"
                aria-describedby="ta-phone-hint"
              />
            </div>
            <p id="ta-phone-hint" className="text-xs text-muted-foreground">
              Must not belong to any real customer, rider or staff account — those are refused.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ta-name">Name (optional)</Label>
            <Input id="ta-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={role === 'RIDER' ? 'Flavrly Test Rider' : 'Flavrly Test Customer'} className="min-h-11" />
          </div>
          <Button
            className="w-full sm:w-auto min-h-11"
            disabled={!phoneValid}
            onClick={() => setPending({ kind: 'create', phone: `+91${digits}`, role, name: name.trim() })}
          >
            Create test {roleLabel(role).toLowerCase()}
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="ta-active" className="space-y-2">
        <h2 id="ta-active" className="font-semibold">Active test accounts</h2>
        {loadError ? <p className="text-sm text-destructive" role="alert">{loadError}</p> : null}
        {accounts === null && !loadError ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</p>
        ) : null}
        {accounts !== null && active.length === 0 ? <p className="text-sm text-muted-foreground">No active test accounts.</p> : null}
        <ul className="space-y-2">
          {active.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="font-mono text-sm break-all">{a.phone}</p>
                <p className="text-xs text-muted-foreground">
                  {roleLabel(a.role)} · {a.name ?? '—'} · created {new Date(a.createdAt).toLocaleDateString('en-IN')}
                  {a.suspendedAt ? ' · suspended' : ''}
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11 text-destructive"
                onClick={() => setPending({ kind: 'delete', phone: a.phone ?? '', role: a.role })}
                aria-label={`Delete test account ${a.phone}`}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </li>
          ))}
        </ul>
        {removed.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Deleted ({removed.length})</summary>
            <ul className="mt-2 space-y-1">
              {removed.map((a) => (
                <li key={a.id} className="text-xs text-muted-foreground break-all">
                  {a.phone} · {roleLabel(a.role)} · deleted {new Date(a.deletedAt!).toLocaleDateString('en-IN')}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <Dialog open={pending !== null} onOpenChange={(o) => { if (!o && !busy) setPending(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'create' ? `Create test ${roleLabel(pending.role).toLowerCase()}?` : 'Delete test account?'}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'create'
                ? `${pending.phone} will get its login code on screen (no SMS). Anyone who knows this number can sign in as it until you delete it.`
                : `${pending?.phone} stops getting on-screen codes, is signed out everywhere and can no longer sign in. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
            <Button
              className="min-h-11"
              variant={pending?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending?.kind === 'create' ? 'Create' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
