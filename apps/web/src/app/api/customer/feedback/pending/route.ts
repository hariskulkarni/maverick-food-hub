/**
 * List of the customer's delivered orders that still need feedback
 * within the 48h window. Used by the order-history banner.
 */
import { auth } from '@/server/auth';
import { pendingFeedbackOrdersForCustomer } from '@/server/feedback';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const pending = await pendingFeedbackOrdersForCustomer(session.user.id);
  return Response.json({ pending });
}
