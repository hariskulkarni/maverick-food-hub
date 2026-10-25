import { describe, it, expect } from 'vitest';
import { checkReplySafety, summarizeIssues } from '@/lib/review-reply-safety';
import { renderTemplate, firstNameOf, STARTER_TEMPLATES } from '@/lib/review-templates';
import { findSensitiveKeyword } from '@/server/reviews/policy';
import { summarizeBrandVoice } from '@/server/reviews/voice';
import { Prisma } from '@prisma/client';

const codes = (t: string, terms: string[] = []) => checkReplySafety(t, terms).map((i) => i.code);

describe('checkReplySafety', () => {
  it('passes an ordinary warm reply', () => {
    expect(codes('Thank you so much! We are glad you loved the biryani and hope to see you again.')).toEqual([]);
  });
  it.each([
    'Get 20% off your next order!',
    'Use promo code SAVE10 next time',
    'Enjoy a free dessert on us next visit',
    'We will send you a coupon',
    'Your next order is on us',
  ])('blocks incentives: %s', (t) => expect(codes(t)).toContain('incentive'));
  it('blocks asking to change or remove the review', () => {
    expect(codes('Please update your review once we fix this.')).toContain('review_change');
    expect(codes('Could you remove the 1 star rating?')).toContain('review_change');
  });
  it('blocks phone numbers in several formats, not short numbers', () => {
    expect(codes('Call 98765 43210')).toContain('phone');
    expect(codes('Call +91-98765-43210')).toContain('phone');
    expect(codes('Call (080) 4123 4567')).toContain('phone');
    expect(codes('We have served 1500 guests since 2019')).not.toContain('phone');
  });
  it('blocks email addresses', () => expect(codes('Write to owner@spice.in')).toContain('email'));
  it('blocks order references and caller-provided private terms (whole words)', () => {
    expect(codes('About order #ORD-AB12CD, sorry')).toContain('order');
    expect(codes('Sorry Ravi was late', ['ORD-1', 'Ravi'])).toContain('order');
    expect(codes('Sorry Ravindra was late', ['Ravi'])).not.toContain('order');
  });
  it('summarizes issues as one message', () => {
    expect(summarizeIssues(checkReplySafety('Email a@b.co for 10% off'))).toMatch(/offers.*email|email.*offers/i);
  });
});

describe('renderTemplate', () => {
  it('fills {name} with the first name and {dish}', () => {
    expect(renderTemplate('Thanks {name}, enjoy the {dish}!', { name: 'Asha Rao', dish: 'Biryani' })).toBe('Thanks Asha, enjoy the Biryani!');
  });
  it('degrades gracefully without name or dish', () => {
    expect(renderTemplate('Thanks {name}, glad you liked the {dish}.', {})).toBe('Thanks there, glad you liked your order.');
    expect(firstNameOf('  ')).toBe('there');
  });
  it('starter templates pass the safety filter', () => {
    for (const t of STARTER_TEMPLATES) expect(checkReplySafety(renderTemplate(t.body, { name: 'A', dish: 'Dosa' }))).toEqual([]);
  });
});

describe('findSensitiveKeyword', () => {
  const kws = ['food poisoning', 'refund', 'allergy'];
  it('matches whole words/phrases case-insensitively', () => {
    expect(findSensitiveKeyword('Got FOOD POISONING after this', kws)).toBe('food poisoning');
    expect(findSensitiveKeyword('I want a refund.', kws)).toBe('refund');
  });
  it('does not match inside other words, empty input or empty list', () => {
    expect(findSensitiveKeyword('nonrefundable deposit', kws)).toBeNull();
    expect(findSensitiveKeyword(null, kws)).toBeNull();
    expect(findSensitiveKeyword('refund', [])).toBeNull();
  });
  it('treats regex characters in keywords literally', () => {
    expect(findSensitiveKeyword('price (high)', ['(high)'])).toBe('(high)');
  });
});

describe('summarizeBrandVoice', () => {
  it('needs at least 3 replies', () => expect(summarizeBrandVoice(['a', 'b'])).toBeNull());
  it('detects we, casual tone, emoji use and a repeated sign-off', () => {
    const s = summarizeBrandVoice([
      "Thanks a ton! We're thrilled 😊 - Team Spice",
      "We're so glad you liked it! 🙏 - Team Spice",
      "Thank you! We can't wait to see you again 😊 - Team Spice",
    ])!;
    expect(s).toContain('"we"');
    expect(s).toContain('casual');
    expect(s).toContain('often uses an emoji');
    expect(s).toContain('Signs off as "Team Spice"');
  });
  it('detects first person, formal tone, no emoji', () => {
    const s = summarizeBrandVoice([
      'Thank you for your kind words. I appreciate your visit.',
      'I am grateful for your feedback. My team will look into it.',
      'Thank you for dining with me. I hope to welcome you again.',
    ])!;
    expect(s).toContain('first person');
    expect(s).toContain('formal');
    expect(s).toContain('avoids emojis');
    expect(s).toContain('No fixed sign-off');
  });
});

describe('schema: review response & insights', () => {
  it('exposes the new models on the Prisma client', () => {
    expect(Prisma.ModelName.ReviewResponseSettings).toBe('ReviewResponseSettings');
    expect(Prisma.ModelName.ReviewReplyTemplate).toBe('ReviewReplyTemplate');
    expect(Prisma.ModelName.ReviewAnalysis).toBe('ReviewAnalysis');
    expect(Prisma.ModelName.ReviewInsightsSnapshot).toBe('ReviewInsightsSnapshot');
    expect(Prisma.ReviewReplyScalarFieldEnum.moderationState).toBe('moderationState');
    expect(Prisma.GoogleReviewScalarFieldEnum.matchedOrderId).toBe('matchedOrderId');
  });
});
