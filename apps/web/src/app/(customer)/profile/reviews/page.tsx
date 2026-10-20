import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { ReviewsClient } from './reviews-client';

export const metadata = { title: 'My reviews' };
export const dynamic = 'force-dynamic';

export default async function MyReviewsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=/profile/reviews');
  return (
    <div className="container py-8 max-w-3xl">
      <h1 className="display text-2xl font-semibold">My reviews</h1>
      <ReviewsClient />
    </div>
  );
}
