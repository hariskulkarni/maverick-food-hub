'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoMark } from '@/components/brand/logo';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

type Status = 'NONE' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'DISABLED';

export function YoupiRequest({ status, receivingVpa, pendingVpa = '' }: { status: Status; receivingVpa: string; pendingVpa?: string }) {
  const router = useRouter();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vpa, setVpa] = useState(pendingVpa || receivingVpa);

  async function post(url: string, body: object, ok: string) {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Request failed');
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <header className="flex items-center gap-3 rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-5">
        <LogoMark className="size-11 shrink-0 shadow-sm" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight tracking-tight text-gradient-brand">Flavrly PG UPI (Experimental)</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Accept UPI payments through the Flavrly PG research gateway.</p>
        </div>
      </header>

      <div role="alert" className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 sm:p-5 text-amber-900 dark:text-amber-200">
        <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="size-5 shrink-0" /> CAUTION</div>
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Flavrly PG is an experimental, self-hosted research gateway — NOT bank/NPCI-certified, audited, or production-grade.</li>
          <li>Payment confirmation is observer-based (bank SMS/email parsing) and is NOT a guarantee of settlement.</li>
          <li>Pilot / low-value use only; a per-day transaction cap applies.</li>
          <li>By requesting this, you accept the experimental risk for these transactions.</li>
        </ul>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:p-5">
          {status === 'REJECTED' && (
            <p className="text-sm text-destructive">Your request was rejected. Contact the platform team; they can reset it so you can request again.</p>
          )}
          {status === 'NONE' && (
            <>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I have read the caution above and accept the experimental risk.</span>
              </label>
              <Button className="w-full sm:w-auto" disabled={!ack || busy}
                onClick={() => post('/api/admin/youpi/request', {}, 'Request sent')}>
                Request this feature
              </Button>
            </>
          )}
          {status === 'REQUESTED' && <p className="text-sm font-medium">Pending super-admin approval.</p>}
          {status === 'DISABLED' && <p className="text-sm font-medium text-muted-foreground">Disabled by platform admin.</p>}
          {status === 'APPROVED' && (
            <>
              <p className="text-sm">
                Active receiving UPI ID: <span className="font-mono">{receivingVpa || 'not set'}</span>
              </p>
              {pendingVpa && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Change requested to <span className="font-mono">{pendingVpa}</span>. It takes effect only after the platform team verifies the bank account.
                </p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="vpa">Request a new receiving UPI ID</Label>
                <Input id="vpa" value={vpa} placeholder="name@bank" onChange={(e) => setVpa(e.target.value)} />
              </div>
              <Button className="w-full sm:w-auto" disabled={busy || !vpa.trim()}
                onClick={() => post('/api/admin/youpi/vpa', { receivingVpa: vpa }, 'Request sent for verification')}>
                Request change
              </Button>
              <p className="text-xs text-muted-foreground">
                Payments stay pending until the bank credit is confirmed on your statement. A per-day transaction cap applies.{' '}
                <Link href="/admin/flavrly-pg" className="text-primary underline">View Flavrly PG payments</Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
