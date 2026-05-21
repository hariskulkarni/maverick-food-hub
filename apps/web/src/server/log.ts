import pino from 'pino';

const base = pino({ level: process.env.LOG_LEVEL || 'info', base: { app: 'restaurant-manager' } });

/**
 * Best-effort tee: every `log.error(...)` is also recorded into the
 * observability error store so the super-admin dashboard can surface it.
 * Fire-and-forget and fully guarded — telemetry must never affect logging.
 *
 * (We capture via the logger rather than Next's `onRequestError`/instrumentation
 * because this app ships an Edge middleware, and an instrumentation file that
 * reaches Node-only code can't be bundled for the Edge runtime. The logger is
 * Node-only, so this is safe.)
 */
function teeError(args: unknown[]): void {
  try {
    const first = args[0];
    let message = '';
    let stack: string | null = null;
    let metaSource: string | null = null;
    if (first && typeof first === 'object') {
      const o = first as Record<string, unknown>;
      const err = (o.err ?? o.error) as { message?: string; stack?: string } | undefined;
      if (err) {
        stack = err.stack ?? null;
        message = err.message ?? '';
      }
      if (typeof o.source === 'string') metaSource = o.source;
      if (!message && typeof args[1] === 'string') message = args[1];
      if (!message && typeof o.msg === 'string') message = o.msg;
    } else if (typeof first === 'string') {
      message = first;
    }
    if (!message) message = 'Logged error';
    // Defer the import so prisma isn't pulled in until first use, and so a
    // failure here can never break logging.
    void import('./observability/store')
      .then((m) => m.recordError({ level: 'ERROR', source: metaSource ?? 'logger', message, stack }))
      .catch(() => {});
  } catch {
    /* never throw from logging */
  }
}

export const log = new Proxy(base, {
  get(target, prop, receiver) {
    if (prop === 'error') {
      return (...args: unknown[]) => {
        teeError(args);
        return (target.error as (...a: unknown[]) => void)(...args);
      };
    }
    return Reflect.get(target, prop, receiver);
  },
}) as typeof base;
