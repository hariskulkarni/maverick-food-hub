import { describe, it, expect } from 'vitest';
import { decideReplyAction } from '@/server/reviews/policy';

const cfg = { enabled: true, autoPostMinRating: 4, draftMaxRating: 3 };

describe('decideReplyAction', () => {
  it('auto-posts at or above autoPostMinRating', () => {
    expect(decideReplyAction(5, cfg)).toBe('AUTO_POST');
    expect(decideReplyAction(4, cfg)).toBe('AUTO_POST');
  });
  it('drafts at or below draftMaxRating', () => {
    expect(decideReplyAction(3, cfg)).toBe('DRAFT');
    expect(decideReplyAction(1, cfg)).toBe('DRAFT');
  });
  it('skips when disabled', () => {
    expect(decideReplyAction(5, { ...cfg, enabled: false })).toBe('SKIP');
  });
  it('skips when no config', () => {
    expect(decideReplyAction(5, null)).toBe('SKIP');
  });
  it('skips a rating that falls in the gap between thresholds', () => {
    // autoPostMinRating 5, draftMaxRating 3 → rating 4 is neither
    expect(decideReplyAction(4, { enabled: true, autoPostMinRating: 5, draftMaxRating: 3 })).toBe('SKIP');
  });
});
