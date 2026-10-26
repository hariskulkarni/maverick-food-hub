/**
 * /feedback/<token> — compliant post-order feedback page (target of the tracked
 * /rv/<token> link and of review-kit QR scans). The customer picks stars and an
 * optional comment; the Google review button is shown the same way at every
 * rating, before and after submitting.
 */
import { notFound } from 'next/navigation';
import { loadFeedbackContext } from '@/server/reviews/review-link';
import { isValidToken } from '@/server/reviews/acquisition';
import { FeedbackLinkClient } from './feedback-link-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rate your order', robots: { index: false, follow: false } };

export default async function FeedbackLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) notFound();
  const ctx = await loadFeedbackContext(token);
  if (!ctx) notFound();
  return <FeedbackLinkClient ctx={JSON.parse(JSON.stringify(ctx))} />;
}
