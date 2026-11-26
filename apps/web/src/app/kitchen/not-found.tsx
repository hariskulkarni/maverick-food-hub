import type { Metadata } from 'next';
import { SearchX } from 'lucide-react';
import { StatusPage, StatusAction } from '@/components/status-page';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * 404 inside the kitchen board. Plain variant: this renders within the
 * console chrome, where the storefront gradient would read as a glitch.
 */
export default function KitchenNotFound() {
  return (
    <StatusPage
      variant="plain"
      showBrand={false}
      code="404"
      icon={<SearchX className="size-6" aria-hidden />}
      title="We can't find that page"
      description="The link may be out of date, or the record may have been removed since you last opened it."
      actions={<StatusAction href="/kitchen">Back to the kitchen board</StatusAction>}
    />
  );
}
