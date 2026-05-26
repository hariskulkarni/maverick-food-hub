import { SubTabs } from '../sub-tabs';

export const dynamic = 'force-dynamic';

const ITEMS = [
  { href: '/admin/storefront/promotions/offers', label: 'Offers' },
  { href: '/admin/storefront/promotions/coupons', label: 'Coupons' },
  { href: '/admin/storefront/promotions/coupon-campaigns', label: 'Coupon Campaigns' },
  { href: '/admin/storefront/promotions/happy-hours', label: 'Happy Hours' },
  { href: '/admin/storefront/promotions/freebies', label: 'Freebies' },
  { href: '/admin/storefront/promotions/challenges', label: 'Challenges' },
  { href: '/admin/storefront/promotions/cross-sell', label: 'Cross-sell' },
  { href: '/admin/storefront/promotions/combos', label: 'Combos' },
];

export default function PromotionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SubTabs items={ITEMS} />
      {children}
    </div>
  );
}
