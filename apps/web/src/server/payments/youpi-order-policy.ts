/**
 * Flavrly PG prepayment guard.
 *
 * Online Flavrly PG orders must not join the restaurant work queue until a
 * server-verified payment allocation releases them. Only this explicit opt-in
 * rail is affected; legacy PhonePe/Razorpay, COD and wallet retain their
 * existing order-placement behavior during the incremental hardening rollout.
 */
export function isDirectUpiPrepayment(method: string, rail?: string | null): boolean {
  return rail === 'youpi' && (method === 'RAZORPAY' || method === 'PHONEPE');
}
