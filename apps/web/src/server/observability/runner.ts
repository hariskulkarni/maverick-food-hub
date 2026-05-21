/**
 * Background probe runner. One interval per Node process, parked on globalThis so
 * Next.js dev HMR (and repeated imports) can't spawn duplicates. Runs the full
 * probe suite on a schedule + once shortly after boot. Best-effort throughout.
 */
declare global {
  // eslint-disable-next-line no-var
  var __obsRunner: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __obsKickoff: ReturnType<typeof setTimeout> | undefined;
}

const PROBE_INTERVAL_MS = 60_000; // every minute

export function startObservabilityRunner(): void {
  if (global.__obsRunner) return; // already running in this process

  const run = () => {
    import('./probes')
      .then((m) => m.runAllProbes())
      .catch(() => {
        /* swallow — retried next tick */
      });
  };

  // First run ~5s after boot (let the server settle), then on the interval.
  global.__obsKickoff = setTimeout(run, 5_000);
  global.__obsRunner = setInterval(run, PROBE_INTERVAL_MS);

  // Don't keep a serverless lambda alive past request end (no-op on a long-lived VPS process).
  if (typeof global.__obsRunner.unref === 'function') global.__obsRunner.unref();
  if (typeof global.__obsKickoff.unref === 'function') global.__obsKickoff.unref();
}
