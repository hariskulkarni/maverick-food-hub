/**
 * Tiny instrumentation hooks other modules call (one line each). Never throw,
 * never await the database — they only bump in-memory per-minute counters.
 */
import { incEvent } from './aggregator';

/** notify.* outcome → per-channel live/mock + sent/failed counters. */
export function recordNotifyOutcome(channel: string, result: { ok: boolean; providerId?: string }): void {
  try {
    const provider = result.providerId?.startsWith('mock_') ? 'mock' : 'live';
    incEvent('notify', channel, `${provider}:${result.ok ? 'SENT' : 'FAILED'}`);
  } catch {
    /* never throw */
  }
}

/**
 * Generic webhook-signature-failure hook. Any webhook handler (incl. the Flavrly
 * PG branch) can call this when a signature / auth check fails.
 */
export function recordWebhookSignatureFailure(provider: string, reason = 'signature'): void {
  try {
    incEvent('webhook_sig', provider.slice(0, 60), reason.slice(0, 60));
  } catch {
    /* never throw */
  }
}

/** Client / native error beacons, counted per source (rate visibility even when deduped). */
export function recordClientErrorBeacon(source: string): void {
  try {
    incEvent('client_error', source.slice(0, 40));
  } catch {
    /* never throw */
  }
}
