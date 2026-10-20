'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PublicReview, PublicReviewsPage } from '@/server/reviews/public';
import { ReviewCard } from '../reviews-section';

export function ReviewsList({ slug, initial }: { slug: string; initial: PublicReviewsPage }) {
  const [reviews, setReviews] = useState<PublicReview[]>(initial.reviews);
  const [page, setPage] = useState(initial.page);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loading, setLoading] = useState(false);

  async function more() {
    setLoading(true);
    try {
      const res = await fetch(`/api/storefront/${slug}/reviews?page=${page + 1}&pageSize=${initial.pageSize}`);
      if (res.ok) {
        const j: PublicReviewsPage = await res.json();
        setReviews((p) => [...p, ...j.reviews]);
        setPage(j.page);
        setHasMore(j.hasMore);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <ul className="mt-6 grid gap-3">{reviews.map((r) => <ReviewCard key={r.id} r={r} />)}</ul>
      {hasMore && (
        <Button className="mt-4 min-h-10" variant="outline" onClick={more} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </>
  );
}
