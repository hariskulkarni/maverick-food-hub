/**
 * Legacy rider KYC route — `/rider/kyc`.
 *
 * The KYC surface has moved to `/rider/profile?tab=documents` as part of the
 * unified Rider Profile + KYC redesign. This route now redirects to keep old
 * bookmarks, push-notification deep links, and the (now-replaced)
 * account-menu link working.
 *
 * The companion files (`kyc-client.tsx`, `document-card.tsx`) are kept in
 * place but unused — they'll be deleted in a follow-up cleanup once nothing
 * else imports them.
 */
import { redirect } from 'next/navigation';

export default function RiderKycLegacyPage() {
  redirect('/rider/profile?tab=documents');
}
