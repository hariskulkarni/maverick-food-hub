import { requireManagedRestaurant } from '@/server/tenancy';
import { ReviewsClient } from './reviews-client';
import { HelpButton } from '@/components/help/help-button';

export const metadata = { title: 'Admin · Reviews' };
export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage() {
  await requireManagedRestaurant();
  return (
    <>
      <div className="flex justify-end px-4 pt-4 sm:px-6">
        <HelpButton appArea="admin.reviews" />
      </div>
      <ReviewsClient />
    </>
  );
}
