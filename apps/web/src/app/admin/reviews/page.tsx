import { requireManagedRestaurant } from '@/server/tenancy';
import { ReviewsClient } from './reviews-client';

export const metadata = { title: 'Admin · Reviews' };
export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage() {
  await requireManagedRestaurant();
  return <ReviewsClient />;
}
