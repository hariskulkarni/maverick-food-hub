/**
 * PhonePe's prescribed Order Status polling cadence.
 *
 * Lives in `lib/` with zero imports because it is needed on both sides of the
 * boundary: the browser status page drives the customer-facing poll, and the
 * server modules reference the same numbers. Putting it in
 * `server/payments/phonepe-api.ts` (which imports `node:crypto`) would drag
 * Node built-ins into the client bundle.
 */

/**
 * Delays in ms between successive Order Status checks for a PENDING payment,
 * per PhonePe's UAT checklist §3:
 *
 *   first check at 20–25s, then every 3s for 30s, every 6s for 60s,
 *   every 10s for 60s, every 30s for 60s, then every 60s until terminal.
 *
 * Encoded once so the client poll, the reconciler and the sweeper cannot drift
 * apart — and so "are we hammering PhonePe?" has a single auditable answer.
 *
 * `skipInitialWait` drops the opening 20s gap. Use it when something else has
 * already performed check #1 — e.g. the customer returning from the PayPage,
 * which our `/api/payments/phonepe/return` route reconciles synchronously.
 */
export function phonePeStatusPollDelays(
  opts: { skipInitialWait?: boolean; maxTotalMs?: number } = {},
): number[] {
  const bands: Array<[everyMs: number, forMs: number]> = [
    [3_000, 30_000],
    [6_000, 60_000],
    [10_000, 60_000],
    [30_000, 60_000],
  ];

  const delays: number[] = [];
  if (!opts.skipInitialWait) delays.push(20_000);
  for (const [every, span] of bands) {
    for (let elapsed = 0; elapsed < span; elapsed += every) delays.push(every);
  }

  const max = opts.maxTotalMs ?? 10 * 60_000;
  let total = delays.reduce((a, b) => a + b, 0);
  while (total < max) {
    delays.push(60_000);
    total += 60_000;
  }
  return delays;
}
