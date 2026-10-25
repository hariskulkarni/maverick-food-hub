'use client';
/**
 * Applicant path: a phone that isn't a rider account yet may have a pending
 * application from /signup/rider. Verify the phone with a code, then show the
 * application status (no session is created).
 */
import { useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { errorMessage, fmtDate } from '../_lib/api';
import { inputCls } from '../_components/bits';

interface AppStatus {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reviewedAt: string | null;
  rejectedReason: string | null;
}

async function post(url: string, body: unknown) {
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function ApplicationStatus({ phone }: { phone: string }) {
  const [stage, setStage] = useState<'start' | 'code' | 'done' | 'none'>('start');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppStatus | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const r = await post('/api/rider/web/application/request-otp', { phone });
    setBusy(false);
    if (r.ok) {
      setDevCode(typeof r.data?.devCode === 'string' ? r.data.devCode : null);
      setStage('code');
    } else if (r.status === 404) setStage('none');
    else setError(errorMessage(r.status, r.data));
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post('/api/rider/web/application/verify', { phone, code });
    setBusy(false);
    if (r.ok) {
      setResult(r.data as AppStatus);
      setStage('done');
    } else if (r.status === 401) setError("That code didn't match or has expired.");
    else if (r.status === 404) setStage('none');
    else setError(errorMessage(r.status, r.data));
  }

  return (
    <section aria-labelledby="app-status-title" className="rounded-3xl border bg-card p-5 shadow-sm">
      <h2 id="app-status-title" className="flex items-center gap-2 font-semibold">
        <ClipboardList className="size-4 text-primary" /> Applied to ride with Flavrly?
      </h2>
      {stage === 'start' && (
        <>
          <p className="mt-1 text-sm text-muted-foreground">If you applied with {phone}, check where your application is.</p>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          <Button variant="outline" className="mt-3 min-h-11 w-full" onClick={start} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Check my application status
          </Button>
        </>
      )}
      {stage === 'code' && (
        <form onSubmit={verify} className="mt-3 space-y-3">
          <div>
            <Label htmlFor="app-code">Code sent to {phone}</Label>
            <input
              id="app-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={cn(inputCls, 'mt-1 text-center tracking-[0.3em]')}
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
            {devCode && (
              <p className="mt-2 rounded-lg bg-muted p-2 text-xs">
                Demo mode — your code is <span className="font-mono font-semibold">{devCode}</span>
              </p>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="min-h-11 w-full" disabled={busy || code.length < 4}>
            {busy && <Loader2 className="animate-spin" />} Show status
          </Button>
        </form>
      )}
      {stage === 'none' && (
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t find an application for {phone}.{' '}
          <Link href="/signup/rider" className="font-medium text-primary underline underline-offset-2">
            Apply to become a rider
          </Link>
          .
        </p>
      )}
      {stage === 'done' && result && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-muted-foreground">Applied on {fmtDate(result.createdAt)}</p>
          {result.status === 'PENDING' && (
            <p className="rounded-xl bg-warning/10 p-3">
              <span className="font-semibold">Under review.</span> Our team is checking your application. You&apos;ll get an SMS when it&apos;s
              approved — then sign in above with the same number.
            </p>
          )}
          {result.status === 'APPROVED' && (
            <p className="rounded-xl bg-success/10 p-3">
              <span className="font-semibold">Approved{result.reviewedAt ? ` on ${fmtDate(result.reviewedAt)}` : ''}.</span> Your rider account is
              still being set up, so sign-in isn&apos;t available yet. If this lasts more than a day, contact Flavrly rider support.
            </p>
          )}
          {result.status === 'REJECTED' && (
            <div className="rounded-xl bg-destructive/5 p-3">
              <p>
                <span className="font-semibold">Not approved{result.reviewedAt ? ` (${fmtDate(result.reviewedAt)})` : ''}.</span>
                {result.rejectedReason ? ` Reason: ${result.rejectedReason}` : ''}
              </p>
              <p className="mt-1">
                Fixed the issue (for example missing documents)?{' '}
                <Link href="/signup/rider" className="font-semibold text-primary underline-offset-4 hover:underline">Apply again</Link>{' '}
                with the same phone number, or contact Flavrly rider support.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
