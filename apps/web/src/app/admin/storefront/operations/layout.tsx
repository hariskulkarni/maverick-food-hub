import { SubTabs } from '../sub-tabs';

export const dynamic = 'force-dynamic';

const ITEMS = [
  { href: '/admin/storefront/operations/dashboard', label: 'Dashboard' },
  { href: '/admin/storefront/operations/orders', label: 'Orders' },
  { href: '/admin/storefront/operations/live', label: 'Live tracking' },
  { href: '/admin/storefront/operations/reservations', label: 'Reservations' },
  { href: '/admin/storefront/operations/tables', label: 'Tables' },
  { href: '/admin/storefront/operations/branches', label: 'Branches' },
];

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SubTabs items={ITEMS} />
      {children}
    </div>
  );
}
