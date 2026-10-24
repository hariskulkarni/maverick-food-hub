/**
 * PgOutbox topic -> handler registry (lead wires handlers at integration, e.g.
 * ORDER_RELEASE -> fulfillment.handleOrderRelease, CUSTOMER_PURCHASE ->
 * crm-events.handleCustomerPurchaseEvent).
 *
 * Handlers run at-least-once (retries, lease takeover after a crash) and MUST be
 * idempotent. Throwing schedules a retry; after the attempt budget the row is
 * dead-lettered with a PgReconException. A topic with no handler is retried and
 * then dead-lettered, never dropped.
 */
export interface OutboxHandlerContext {
  id: string;
  topic: string;
  aggregateId: string;
  attempts: number;
}

export type OutboxHandler = (payload: unknown, ctx: OutboxHandlerContext) => Promise<void>;

export const outboxHandlers: Record<string, OutboxHandler> = {};
