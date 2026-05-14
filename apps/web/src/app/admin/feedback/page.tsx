/**
 * Admin · Feedback
 *
 * Server component. Loads the last 30 days of feedback for this restaurant
 * via `loadRestaurantFeedback`, projects each row through the ADMIN role
 * gate (delivery rating stripped, food-related tags only), and hands a
 * JSON-serialisable payload to the client component.
 *
 * The `(prisma as any)` cast lives inside the loader — this page stays clean.
 */
import { requireRestaurant } from '@/server/tenancy';
import { loadRestaurantFeedback, visibleForRole } from '@/server/feedback';
import { FeedbackClient } from './feedback-client';

export const metadata = { title: 'Admin · Feedback' };
export const dynamic = 'force-dynamic';

export default async function AdminFeedbackPage() {
  const restaurant = await requireRestaurant();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);

  const { rows, summary } = await loadRestaurantFeedback(restaurant.id, { from, to });

  // Project rows through ADMIN visibility — strip delivery rating + non-food tags.
  // Keep `order` metadata so the table can render "Open order →" links.
  const projected = rows.map((r: any) => ({
    ...visibleForRole(r, 'ADMIN'),
    order: {
      id: r.orderId,
      code: r.order?.code ?? null,
      total: r.order?.total ?? null
    }
  }));

  // Strip delivery aggregates from the admin-facing summary.
  const { avgDelivery: _ad, lowDeliveryCount: _ld, ...adminSummary } = summary;

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="display text-2xl font-semibold">Customer feedback</h1>
        <p className="text-sm text-muted-foreground">
          Ratings and comments from your last 30 days of deliveries.
          Delivery-side ratings live in the rider and platform views.
        </p>
      </header>
      <FeedbackClient
        initialRows={JSON.parse(JSON.stringify(projected))}
        initialSummary={JSON.parse(JSON.stringify(adminSummary))}
      />
    </div>
  );
}
