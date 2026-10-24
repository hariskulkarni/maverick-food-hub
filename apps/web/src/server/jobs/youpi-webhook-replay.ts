/**
 * Replays inbound Flavrly PG webhook deliveries that were durably saved but not
 * yet processed. Kept as a compatibility entry point: the implementation is the
 * lease-based inbox (server/pg/inbox.ts), which replaced the old `error`-column
 * claim marker with explicit leaseOwner/leaseExpiresAt/attempts/nextAttemptAt
 * and dead-lettering.
 *
 * This does NOT repair a gateway-side webhook that was never emitted (upstream
 * issue #86); the gateway-status sweep remains that safety net.
 */
import { runInbox, type InboxRunResult } from '../pg/inbox';

export type YoupiWebhookReplayResult = InboxRunResult;

export async function runYoupiWebhookReplay(): Promise<YoupiWebhookReplayResult> {
  return runInbox();
}
