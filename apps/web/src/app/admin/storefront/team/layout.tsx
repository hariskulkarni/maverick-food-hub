import { SubTabs } from '../sub-tabs';

export const dynamic = 'force-dynamic';

const ITEMS = [
  { href: '/admin/storefront/team/riders', label: 'Dedicated Riders' },
  { href: '/admin/storefront/team/safety', label: 'Rider Safety' },
  { href: '/admin/storefront/team/messages', label: 'Messages' },
];

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SubTabs items={ITEMS} />
      {children}
    </div>
  );
}
