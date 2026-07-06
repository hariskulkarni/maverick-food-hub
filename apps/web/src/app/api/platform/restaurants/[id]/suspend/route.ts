import { NextRequest } from 'next/server';
import { confidentialAction } from '@/server/approvals';

/**
 * POST — suspend a restaurant. CONFIDENTIAL: a super-admin runs it directly; an
 * Admin Assist's request is queued for approval (202). See src/server/approvals.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return confidentialAction(req, 'restaurant.suspend', { restaurantId: id });
}
