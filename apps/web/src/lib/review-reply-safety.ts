/**
 * Safety filter for PUBLIC Google review replies (AI-generated or typed).
 * Pure and dependency-free so the admin UI shows the same inline warning the
 * server enforces.
 *
 * Blocks:
 *  - incentives: offers/discounts/freebies, or asking the reviewer to change or
 *    remove their review (Google policy, FTC 16 CFR 465);
 *  - PII: phone numbers and email addresses;
 *  - order details: order numbers/codes and anything from the matched order the
 *    caller passes as `privateTerms` (order code, rider name, customer phone).
 */
export type SafetyIssue = { code: 'incentive' | 'review_change' | 'phone' | 'email' | 'order'; message: string };

const INCENTIVE = /\b(discount|coupon|voucher|promo\s*code|cash\s*back|cashback|\d{1,3}\s*%\s*off|free\s+(meal|dessert|drink|item|order|delivery|dish|starter)|complimentary|on\s+the\s+house|gift\s*card|reward\s*points?|loyalty\s*points?|next\s+order\s+(is\s+)?(on\s+us|free))\b/i;
const REVIEW_CHANGE = /\b(update|edit|change|remove|delete|revise|take\s+down|reconsider)\b[^.!?]{0,40}\b(review|rating|stars?)\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ORDER_REF = /\b(order\s*(id|no\.?|number|#)\s*[:#]?\s*[A-Z0-9-]{3,}|ORD-[A-Z0-9]{3,})\b/i;

function hasPhone(text: string): boolean {
  // 10+ digits, allowing spaces/dashes/brackets/+ between them.
  const runs = text.match(/\+?\d[\d\s().-]{8,}\d/g) ?? [];
  return runs.some((r) => r.replace(/\D/g, '').length >= 10);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function checkReplySafety(text: string, privateTerms: Array<string | null | undefined> = []): SafetyIssue[] {
  const t = text ?? '';
  const issues: SafetyIssue[] = [];
  if (INCENTIVE.test(t)) issues.push({ code: 'incentive', message: 'Remove offers, discounts or freebies. Public replies must not offer anything in exchange for a review.' });
  if (REVIEW_CHANGE.test(t)) issues.push({ code: 'review_change', message: 'Do not ask the guest to change or remove their review.' });
  if (hasPhone(t)) issues.push({ code: 'phone', message: 'Remove the phone number. Never post contact or personal details publicly.' });
  if (EMAIL.test(t)) issues.push({ code: 'email', message: 'Remove the email address. Invite them to contact you privately instead.' });
  const orderHit = ORDER_REF.test(t) || privateTerms.some((term) => {
    const v = (term ?? '').trim();
    return v.length >= 3 && new RegExp(`(^|\\W)${escapeRe(v)}(\\W|$)`, 'i').test(t);
  });
  if (orderHit) issues.push({ code: 'order', message: 'Remove order details (order number, rider, delivery details). Keep order context private.' });
  return issues;
}

export function summarizeIssues(issues: SafetyIssue[]): string {
  return issues.map((i) => i.message).join(' ');
}
