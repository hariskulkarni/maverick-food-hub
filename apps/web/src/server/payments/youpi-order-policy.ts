/**
 * Flavrly PG prepayment guard.
 *
 * Online Flavrly PG orders must not join the restaurant work queue until a
 * server-verified payment allocation releases them (ORDER_RELEASE). Since the
 * customer-flow audit (round 3) every online order — PhonePe and Razorpay too —
 * starts PAYMENT_PENDING; this predicate only identifies the PG rail, whose
 * capture is bank-allocation-only (allocateBankCredit).
 */
export function isDirectUpiPrepayment(method: string, rail?: string | null): boolean {
  return rail === 'youpi' && (method === 'RAZORPAY' || method === 'PHONEPE');
}
