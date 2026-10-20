/**
 * Customer help / order-issue helpers. Tickets are created through the
 * existing POST /api/support/tickets endpoint (same store the platform
 * support inbox reads) — no separate storage.
 */
export const ISSUE_CATEGORIES = [
  { value: 'ORDER_DELAY', label: 'Order is late' },
  { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'MISSING_ITEM', label: 'Missing item' },
  { value: 'FOOD_QUALITY', label: 'Food quality' },
  { value: 'DELIVERY_NOT_RECEIVED', label: 'Order not received' },
  { value: 'PAYMENT_ISSUE', label: 'Payment problem' },
  { value: 'REFUND_REQUEST', label: 'Refund request' },
  { value: 'RIDER_ISSUE', label: 'Delivery partner issue' },
  { value: 'OTHER', label: 'Something else' }
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]['value'];

export interface IssueInput {
  category: IssueCategory;
  description: string;
  orderId?: string;
}

export function buildIssueTicket(i: IssueInput) {
  const orderId = i.orderId?.trim();
  return {
    type: i.category,
    message: i.description.trim(),
    ...(orderId ? { orderId } : {})
  };
}

export async function submitIssue(
  input: IssueInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; ticketId: string } | { ok: false }> {
  try {
    const res = await fetchImpl('/api/support/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildIssueTicket(input))
    });
    if (!res.ok) return { ok: false };
    const j = await res.json();
    return { ok: true, ticketId: j.ticket.id };
  } catch {
    return { ok: false };
  }
}
