import { NextRequest } from 'next/server';
import { confidentialAction } from '@/server/approvals';

/**
 * POST — archive (soft-delete) a restaurant. CONFIDENTIAL: super-admin runs it
 * directly; an Admin Assist's request is queued for approval (202).
 * Hides it from customers (status→SUSPENDED, deletedAt set) and frees the slug.
 * Reversible via /restore.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return confidentialAction(req, 'restaurant.archive', { restaurantId: id });
}
