/**
 * Super-admin (/platform) sidebar, grouped by operation.
 *
 * Plain serialisable data (icons are string keys, resolved to lucide icons in
 * the client component), so the server layout can capability-filter it and
 * hand it to the client nav without crossing the RSC function boundary.
 *
 * Every /platform page must appear here exactly once
 * (__tests__/app/platform-nav.test.ts enforces it).
 */

export type PlatformNavIcon =
  | 'dashboard' | 'analytics' | 'reports' | 'live' | 'liveOps'
  | 'orders' | 'restaurants' | 'brands' | 'cms' | 'qr' | 'feedback' | 'reviews'
  | 'riders' | 'kyc' | 'shifts' | 'dispatch' | 'surge' | 'settings' | 'training' | 'appReleases'
  | 'payoutRules' | 'riderPayouts' | 'incentives' | 'tiers' | 'referrals'
  | 'sos' | 'incidents' | 'riderSupport' | 'messages'
  | 'settlements' | 'cod' | 'gateways' | 'pg' | 'pgAdmin'
  | 'users' | 'testAccounts' | 'support' | 'help' | 'bonus'
  | 'iam' | 'approvals' | 'security' | 'auditLog' | 'health' | 'observability' | 'pos';

export interface PlatformNavItem {
  href: string;
  label: string;
  icon: PlatformNavIcon;
  /** Extra search terms (aliases) for the quick filter. */
  keywords?: string[];
}

export interface PlatformNavGroup {
  id: string;
  title: string;
  items: PlatformNavItem[];
}

export const PLATFORM_NAV: PlatformNavGroup[] = [
  {
    id: 'overview',
    title: 'Overview',
    items: [
      { href: '/platform', label: 'Dashboard', icon: 'dashboard', keywords: ['home', 'kpi', 'summary'] },
      { href: '/platform/live-ops', label: 'Live ops', icon: 'liveOps', keywords: ['stuck', 'escalation', 'alerts'] },
      { href: '/platform/live', label: 'Live tracking', icon: 'live', keywords: ['map', 'gps', 'realtime'] },
      { href: '/platform/analytics', label: 'Deep analytics', icon: 'analytics', keywords: ['metrics', 'charts', 'gmv'] },
      { href: '/platform/reports', label: 'Reports', icon: 'reports', keywords: ['export', 'excel', 'csv'] },
    ],
  },
  {
    id: 'orders-restaurants',
    title: 'Orders & restaurants',
    items: [
      { href: '/platform/orders', label: 'All orders', icon: 'orders', keywords: ['order'] },
      { href: '/platform/restaurants', label: 'Restaurants', icon: 'restaurants', keywords: ['tenant', 'outlet', 'onboarding'] },
      { href: '/platform/brands', label: 'Brands', icon: 'brands', keywords: ['group', 'chain'] },
      { href: '/platform/discovery-cms', label: 'Discovery CMS', icon: 'cms', keywords: ['homepage', 'banners', 'carousel', 'storefront'] },
      { href: '/platform/qr', label: 'QR codes', icon: 'qr', keywords: ['table', 'print'] },
      { href: '/platform/feedback', label: 'Feedback', icon: 'feedback', keywords: ['ratings', 'complaints'] },
      { href: '/platform/reviews-analytics', label: 'Review analytics', icon: 'reviews', keywords: ['google', 'reviews', 'stars'] },
      { href: '/platform/novaryq', label: 'Novaryq POS', icon: 'pos', keywords: ['pos', 'integration', 'kitchen', 'sync'] },
    ],
  },
  {
    id: 'riders-dispatch',
    title: 'Riders & dispatch',
    items: [
      { href: '/platform/riders', label: 'Riders', icon: 'riders', keywords: ['delivery', 'partner', 'fleet'] },
      { href: '/platform/kyc', label: 'KYC review', icon: 'kyc', keywords: ['documents', 'verification', 'license', 'aadhaar'] },
      { href: '/platform/rider-shifts', label: 'Rider shifts', icon: 'shifts', keywords: ['schedule', 'roster'] },
      { href: '/platform/dispatch-insights', label: 'Dispatch insights', icon: 'dispatch', keywords: ['jit', 'food ready', 'prep time'] },
      { href: '/platform/surge-zones', label: 'Surge zones', icon: 'surge', keywords: ['demand', 'pricing', 'zones'] },
      { href: '/platform/rider-settings', label: 'Rider settings', icon: 'settings', keywords: ['kyc gate', 'config'] },
      { href: '/platform/training-modules', label: 'Training modules', icon: 'training', keywords: ['courses', 'quiz', 'certificate', 'lms'] },
      { href: '/platform/app-releases', label: 'Rider app releases', icon: 'appReleases', keywords: ['apk', 'android', 'version', 'update'] },
    ],
  },
  {
    id: 'rider-pay',
    title: 'Rider pay & growth',
    items: [
      { href: '/platform/payouts', label: 'Payout rules', icon: 'payoutRules', keywords: ['rider pay', 'per km', 'rates'] },
      { href: '/platform/rider-payouts', label: 'Rider payouts', icon: 'riderPayouts', keywords: ['earnings', 'wallet', 'pay'] },
      { href: '/platform/rider-incentives', label: 'Incentives', icon: 'incentives', keywords: ['bonus', 'targets'] },
      { href: '/platform/rider-tiers', label: 'Rider tiers', icon: 'tiers', keywords: ['levels', 'gold', 'silver'] },
      { href: '/platform/rider-referrals', label: 'Rider referrals', icon: 'referrals', keywords: ['invite', 'refer'] },
    ],
  },
  {
    id: 'rider-safety',
    title: 'Rider safety & support',
    items: [
      { href: '/platform/rider-sos', label: 'SOS alerts', icon: 'sos', keywords: ['emergency', 'panic'] },
      { href: '/platform/rider-incidents', label: 'Incidents', icon: 'incidents', keywords: ['accident', 'report'] },
      { href: '/platform/rider-support', label: 'Rider support', icon: 'riderSupport', keywords: ['tickets', 'helpdesk'] },
      { href: '/platform/messages', label: 'Messages', icon: 'messages', keywords: ['chat', 'inbox'] },
    ],
  },
  {
    id: 'finance',
    title: 'Finance & payments',
    items: [
      { href: '/platform/settlements', label: 'Settlements', icon: 'settlements', keywords: ['commission', 'payout', 'restaurant pay'] },
      { href: '/platform/cod', label: 'COD', icon: 'cod', keywords: ['cash on delivery', 'reconciliation', 'cash'] },
      { href: '/platform/payment-gateways', label: 'Payment gateways', icon: 'gateways', keywords: ['phonepe', 'razorpay', 'upi'] },
      { href: '/platform/youpi', label: 'Flavrly PG', icon: 'pg', keywords: ['upi', 'pg', 'youpi', 'receiving account', 'bank'] },
      { href: '/platform/youpi-admin', label: 'Flavrly PG Admin', icon: 'pgAdmin', keywords: ['upi', 'pg', 'youpi', 'gateway admin', 'ops'] },
    ],
  },
  {
    id: 'customers-support',
    title: 'Customers & support',
    items: [
      { href: '/platform/users', label: 'All users', icon: 'users', keywords: ['customers', 'accounts', 'staff', 'password reset'] },
      { href: '/platform/users/test-accounts', label: 'Test accounts', icon: 'testAccounts', keywords: ['test rider', 'test customer', 'dummy', 'otp', 'pre-launch', 'demo'] },
      { href: '/platform/support', label: 'Support', icon: 'support', keywords: ['tickets', 'helpdesk', 'complaints'] },
      { href: '/platform/help', label: 'Help center', icon: 'help', keywords: ['faq', 'knowledge base', 'articles', 'kb'] },
      { href: '/platform/signup-bonus', label: 'Signup bonus', icon: 'bonus', keywords: ['welcome', 'wallet', 'promo'] },
    ],
  },
  {
    id: 'access-system',
    title: 'Access & system',
    items: [
      { href: '/platform/iam', label: 'IAM & roles', icon: 'iam', keywords: ['permissions', 'roles', 'admin assist'] },
      { href: '/platform/approvals', label: 'Approvals', icon: 'approvals', keywords: ['requests', 'confidential'] },
      { href: '/platform/security', label: 'Security', icon: 'security', keywords: ['2fa', 'totp', 'ip allowlist', 'sessions'] },
      { href: '/platform/audit-log', label: 'Audit log', icon: 'auditLog', keywords: ['history', 'activity'] },
      { href: '/platform/system-health', label: 'System health', icon: 'health', keywords: ['status', 'uptime', 'jobs', 'cron'] },
      { href: '/platform/observability', label: 'Observability', icon: 'observability', keywords: ['logs', 'alerts', 'errors', 'monitoring'] },
    ],
  },
];

/** Keep only items the caller may open; drop groups that end up empty. */
export function filterNavByAccess(
  groups: PlatformNavGroup[],
  allowed: (href: string) => boolean,
): PlatformNavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => allowed(it.href)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Quick filter: every whitespace-separated term must appear in the item's
 * label, its group title or one of its keywords (case-insensitive).
 */
export function filterNavByQuery(groups: PlatformNavGroup[], query: string): PlatformNavGroup[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const hay = [it.label, g.title, ...(it.keywords ?? [])].join(' ').toLowerCase();
        return terms.every((t) => hay.includes(t));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/** The nav href that owns `pathname` (longest matching prefix), or null. */
export function activeHref(groups: PlatformNavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const g of groups) {
    for (const it of g.items) {
      const match = pathname === it.href || pathname.startsWith(it.href + '/');
      if (match && (best === null || it.href.length > best.length)) best = it.href;
    }
  }
  return best;
}
