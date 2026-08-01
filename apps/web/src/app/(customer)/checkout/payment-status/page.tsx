/**
 * Landing page after a PhonePe PayPage concludes.
 *
 * The customer arrives here from `/api/payments/phonepe/return` (which has
 * already reconciled once). UPI collect can stay PENDING for a minute or two
 * after the browser returns, so this page keeps polling the status endpoint —
 * each poll re-asks PhonePe — until the payment is terminal, then forwards to
 * order tracking.
 */
import { Suspense } from 'react';
import { PaymentStatusView } from './payment-status-view';

export const dynamic = 'force-dynamic';

export default function PaymentStatusPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading…</p>}>
        <PaymentStatusView />
      </Suspense>
    </div>
  );
}
