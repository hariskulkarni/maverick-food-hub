import { describe, it, expect } from 'vitest';
import { publishedRatingWhere } from '@/server/reviews/published';

describe('publishedRatingWhere', () => {
  it('counts only PUBLISHED, rated, tenant-scoped feedback', () => {
    expect(publishedRatingWhere('rest1')).toEqual({
      overallRating: { not: null },
      moderationStatus: 'PUBLISHED',
      order: { branch: { restaurantId: 'rest1' } }
    });
  });
});
