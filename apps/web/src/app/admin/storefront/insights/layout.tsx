import { SubTabs } from '../sub-tabs';

export const dynamic = 'force-dynamic';

const ITEMS = [
  { href: '/admin/storefront/insights/reports', label: 'Reports' },
  { href: '/admin/storefront/insights/activity', label: 'Activity' },
  { href: '/admin/storefront/insights/feedback', label: 'Feedback' },
];

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SubTabs items={ITEMS} />
      {children}
    </div>
  );
}
