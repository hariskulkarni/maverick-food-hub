/**
 * Public-facing feedback filter: only PUBLISHED rows count toward the
 * storefront rating badge / aggregate. HIDDEN and FLAGGED rows are excluded.
 */
export function publishedRatingWhere(restaurantId: string) {
  return {
    overallRating: { not: null as null },
    moderationStatus: 'PUBLISHED' as const,
    order: { branch: { restaurantId } }
  };
}
