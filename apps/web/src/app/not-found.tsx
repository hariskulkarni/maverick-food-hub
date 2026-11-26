import type { Metadata } from 'next';
import { Compass } from 'lucide-react';
import { StatusPage, StatusAction, StatusActionSecondary } from '@/components/status-page';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * Root 404. Catches every unmatched URL on both hostnames, plus any
 * `notFound()` raised outside the customer/admin/kitchen/platform segments
 * (each of which has its own, so the 404 lands inside the right chrome).
 */
export default function NotFound() {
  return (
    <StatusPage
      code="404"
      icon={<Compass className="size-6" aria-hidden />}
      title="We can't find that page"
      description="The link may be broken, or the page may have moved. It happens — let's get you back to the food."
      actions={
        <>
          <StatusAction href="/restaurants">Browse restaurants</StatusAction>
          <StatusActionSecondary href="/">Go home</StatusActionSecondary>
        </>
      }
    />
  );
}
