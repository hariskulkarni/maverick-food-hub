import Link from 'next/link';
import { Star } from 'lucide-react';
import type { PublicReview, PublicReviewsPage } from '@/server/reviews/public';

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-4 ${i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
      ))}
    </span>
  );
}

export function ReviewCard({ r }: { r: PublicReview }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={r.rating} />
        <span className="font-medium">{r.author}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          {r.source === 'google' ? ' · via Google' : ''}
        </span>
      </div>
      {r.comment && <p className="mt-2 text-sm break-words">{r.comment}</p>}
      {r.reply && (
        <div className="mt-3 rounded-lg bg-muted/60 border-l-4 border-primary px-3 py-2 text-sm">
          <p className="text-xs font-semibold text-muted-foreground">Response from the restaurant</p>
          <p className="mt-1 break-words">{r.reply.text}</p>
        </div>
      )}
    </li>
  );
}

export function Aggregate({ data }: { data: PublicReviewsPage['aggregate'] }) {
  if (!data.count || data.average == null) return <p className="text-sm text-muted-foreground">No reviews yet.</p>;
  return (
    <div className="flex items-center gap-3">
      <span className="display text-3xl font-semibold">{data.average.toFixed(1)}</span>
      <div>
        <Stars value={data.average} />
        <p className="text-xs text-muted-foreground">
          Average of all {data.count} review{data.count === 1 ? '' : 's'}
          {data.inAppCount > 0 && data.googleCount > 0 ? ` (${data.inAppCount} in-app, ${data.googleCount} from Google)` : ''}
        </p>
        {data.google?.average != null && data.google.count != null && (
          <p className="text-xs text-muted-foreground">
            Google rating {data.google.average.toFixed(1)} from {data.google.count} review{data.google.count === 1 ? '' : 's'} on Google
          </p>
        )}
      </div>
    </div>
  );
}

export function ReviewsSection({ slug, data }: { slug: string; data: PublicReviewsPage | null }) {
  if (!data || data.aggregate.count === 0) return null;
  return (
    <section id="reviews" className="container py-8" aria-labelledby="reviews-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="reviews-h" className="display text-xl md:text-2xl font-semibold">What customers say</h2>
        <Aggregate data={data.aggregate} />
      </div>
      <ul className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}
      </ul>
      {data.aggregate.count > data.reviews.length && (
        <Link href={`/r/${slug}/reviews`} className="mt-4 inline-flex min-h-11 items-center font-medium text-primary hover:underline">
          See all {data.aggregate.count} reviews
        </Link>
      )}
    </section>
  );
}
