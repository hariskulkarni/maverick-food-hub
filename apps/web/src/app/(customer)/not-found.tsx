import type { Metadata } from 'next';
import { UtensilsCrossed } from 'lucide-react';
import { StatusPage, StatusAction, StatusActionSecondary } from '@/components/status-page';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * Storefront 404 — the one most people will actually hit, since it also covers
 * every `notFound()` for a missing restaurant, menu item, order or QR code.
 * Renders inside the customer chrome (header, bottom nav), so it keeps the
 * normal navigation rather than stranding the visitor.
 */
export default function CustomerNotFound() {
  return (
    <StatusPage
      variant="plain"
      showBrand={false}
      code="404"
      icon={<UtensilsCrossed className="size-6" aria-hidden />}
      title="This page is off the menu"
      description="We couldn't find what you were looking for. The restaurant or dish may no longer be available."
      actions={
        <>
          <StatusAction href="/restaurants">Browse restaurants</StatusAction>
          <StatusActionSecondary href="/orders">My orders</StatusActionSecondary>
        </>
      }
    />
  );
}
