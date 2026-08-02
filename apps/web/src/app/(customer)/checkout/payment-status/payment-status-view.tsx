'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { openPhonePeCheckout } from '@/lib/phonepe-checkout';
import { phonePeStatusPollDelays } from '@/lib/phonepe-poll';
import { toast } from 'sonner';

type Phase = 'PENDING' | 'COMPLETED' | 'FAILED';

/**
 * Poll cadence — PhonePe's own prescribed Order Status schedule (UAT checklist
 * §3), not an improvised one: every 3s for 30s, then 6s for 60s, 10s for 60s,
 * 30s for 60s, then every 60s.
 *
 * We skip their opening 20-second wait because the browser landing here IS the
 * signal that the customer finished, and `/api/payments/phonepe/return` has
 * already performed the first status check server-side. Starting in the
 * 3-second band means a card payment confirms almost immediately instead of the
 * customer watching a spinner for 20 seconds.
 *
 * Each poll costs one upstream PhonePe call, so respecting their cadence is
 * also what keeps us from hammering a rate-limited API.
 */
const POLL_SCHEDULE_MS = phonePeStatusPollDelays({ skipInitialWait: true, maxTotalMs: 5 * 60_000 });
const MAX_POLL_MS = 5 * 60_000;

export function PaymentStatusView() {
  const params = useSearchParams();
  const router = useRouter();
  const orderId = params.get('orderId') ?? '';

  const [phase, setPhase] = useState<Phase>('PENDING');
  const [error, setError] = useState<string | null>(null);
  const [orderCode, setOrderCode] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const startedAt = useRef(Date.now());
  const attempt = useRef(0);

  useEffect(() => {
    if (!orderId) {
      setPhase('FAILED');
      setError('We could not identify that order.');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/payments/phonepe/status?orderId=${encodeURIComponent(orderId)}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (cancelled) return;

        if (data.orderCode) setOrderCode(data.orderCode);

        if (data.state === 'COMPLETED') {
          setPhase('COMPLETED');
          // Brief pause so the customer registers the confirmation.
          timer = setTimeout(() => router.replace(`/orders/${orderId}`), 1400);
          return;
        }
        // `indeterminate` means we could not reach PhonePe — keep waiting
        // rather than telling the customer a payment failed when it may not
        // have.
        if (data.state === 'FAILED' && !data.indeterminate) {
          setPhase('FAILED');
          setError(data.error ?? 'The payment did not go through.');
          return;
        }
      } catch {
        // Network blip on our own endpoint — keep polling.
      }

      if (cancelled) return;
      if (Date.now() - startedAt.current > MAX_POLL_MS) {
        router.replace(`/orders/${orderId}`);
        return;
      }
      const delay = POLL_SCHEDULE_MS[Math.min(attempt.current, POLL_SCHEDULE_MS.length - 1)];
      attempt.current += 1;
      timer = setTimeout(poll, delay);
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, router]);

  /** Mint a fresh PayPage — the previous merchantOrderId cannot be reused. */
  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/pay`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not restart the payment.');
      const p = data.payment;
      if (!p?.redirectUrl) throw new Error('The payment gateway did not return a checkout link.');
      await openPhonePeCheckout({ tokenUrl: p.redirectUrl, scriptUrl: p.checkoutScriptUrl });
      // Whatever the PayPage reports, the server decides — restart polling.
      startedAt.current = Date.now();
      attempt.current = 0;
      setPhase('PENDING');
      setError(null);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }, [orderId, router]);

  return (
    <Card>
      <CardContent className="p-8 text-center">
        {phase === 'PENDING' && (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-primary" />
            <h1 className="mt-4 text-lg font-semibold">Confirming your payment…</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This usually takes a few seconds. If you paid by UPI collect, approve the request in your UPI app.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">Please don’t close this page.</p>
          </>
        )}

        {phase === 'COMPLETED' && (
          <>
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="mt-4 text-lg font-semibold">Payment received</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {orderCode ? `Order ${orderCode} is confirmed.` : 'Your order is confirmed.'} Taking you to tracking…
            </p>
          </>
        )}

        {phase === 'FAILED' && (
          <>
            <XCircle className="mx-auto size-10 text-destructive" />
            <h1 className="mt-4 text-lg font-semibold">Payment didn’t go through</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              You haven’t been charged. If money did leave your account, it is auto-reversed by your bank — usually
              within 3–5 working days.
            </p>
            <div className="mt-6 grid gap-2">
              <Button onClick={retry} disabled={retrying}>
                {retrying ? 'Starting…' : 'Try payment again'}
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/orders/${orderId}`}>View order</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
