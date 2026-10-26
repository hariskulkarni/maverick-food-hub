import { requireManagedRestaurant } from '@/server/tenancy';
import { InsightsClient } from './insights-client';

export const metadata = { title: 'Admin · Review insights' };
export const dynamic = 'force-dynamic';

export default async function ReviewInsightsPage() {
  await requireManagedRestaurant();
  return <InsightsClient />;
}
