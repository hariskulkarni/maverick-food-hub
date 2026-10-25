/**
 * Compliance: the Google review button is rendered identically at EVERY rating,
 * before and after feedback, on the tracked feedback page and the order tracker
 * block. Renders the real components to static markup.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/link', () => ({ default: (p: any) => createElement('a', { href: p.href }, p.children) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { FeedbackLinkClient } from '@/app/(customer)/feedback/[token]/feedback-link-client';
import { GoogleReviewBlock } from '@/components/reviews/google-review-button';

const GOOGLE = 'https://search.google.com/local/writereview?placeid=PLACE1';
const base = {
  token: 'tok_abcdefghijklmnopqrstu',
  requestId: 'rr1',
  restaurant: { id: 'r1', name: 'Spice Hub', logoUrl: null, slug: 'spice' },
  order: { id: 'o1', code: 'ORD-1', items: [{ name: 'Biryani', quantity: 1 }] },
  existing: null,
  canSubmit: true,
  closedReason: null,
  googleUrl: GOOGLE,
  lowRatingThreshold: 3,
} as const;

function googleBlock(html: string): string {
  const m = html.match(/<div[^>]*data-testid="google-review-block"[\s\S]*?<\/a><\/div><\/div>/);
  expect(m, 'google block present').toBeTruthy();
  return m![0];
}

describe('Google review link shown at every rating', () => {
  it('before submitting: same block for no rating and ratings 1..5', () => {
    const blocks = new Set<string>();
    for (const r of [0, 1, 2, 3, 4, 5]) {
      const html = renderToStaticMarkup(createElement(FeedbackLinkClient, { ctx: base as any, initialRating: r }));
      const b = googleBlock(html);
      expect(b).toContain(`href="${GOOGLE.replace(/&/g, '&amp;')}"`);
      blocks.add(b);
    }
    expect(blocks.size).toBe(1);
  });

  it('after submitting (any stored rating 1..5, order or QR): the same block again', () => {
    const before = googleBlock(renderToStaticMarkup(createElement(FeedbackLinkClient, { ctx: base as any })));
    for (const rating of [1, 2, 3, 4, 5]) {
      for (const order of [base.order, null]) {
        const ctx = { ...base, order, canSubmit: false, existing: { rating, comment: null } };
        expect(googleBlock(renderToStaticMarkup(createElement(FeedbackLinkClient, { ctx: ctx as any })))).toBe(before);
      }
    }
    const closed = { ...base, canSubmit: false, closedReason: 'window_expired' };
    expect(googleBlock(renderToStaticMarkup(createElement(FeedbackLinkClient, { ctx: closed as any })))).toBe(before);
  });

  it('the block component has no rating input at all', () => {
    const a = renderToStaticMarkup(createElement(GoogleReviewBlock, { href: GOOGLE }));
    expect(a).toContain('Review us on Google');
    expect(a).toContain('target="_blank"');
    expect(a).toContain('rel="noopener noreferrer"');
    expect(GoogleReviewBlock.length).toBeLessThanOrEqual(1); // single props object: { href, trackUrl }
  });
});
