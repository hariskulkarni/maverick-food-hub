import { requireSuperAdmin } from '@/server/tenancy';
import { ReportRangePicker } from '@/app/_components/report-range-picker';

export const metadata = { title: 'Platform · Reports' };

const REPORTS = [
  {
    slug: 'gmv-by-day',
    title: 'GMV by day',
    description: 'Daily orders, GMV, commission, delivery fees and rider payouts across all restaurants.'
  },
  {
    slug: 'restaurant-sales',
    title: 'Restaurant sales',
    description: 'Per-restaurant orders, GMV, commission earned, and refund count.'
  },
  {
    slug: 'rider-earnings',
    title: 'Rider earnings',
    description: 'Per-rider trips and earnings split: base, bonus, tips, total.'
  },
  {
    slug: 'cod-pending',
    title: 'COD pending',
    description: 'Pending cash collections per rider, with mismatches and oldest pending age.'
  },
  {
    slug: 'payment-mode-split',
    title: 'Payment mode split',
    description: 'Counts and totals by payment method (Razorpay, COD, Wallet).'
  },
  {
    slug: 'cancellations',
    title: 'Cancellations',
    description: 'All cancelled orders with restaurant, customer, reason and refunded amount.'
  },
  {
    slug: 'delayed-orders',
    title: 'Delayed orders',
    description: 'Orders that exceeded SLA — placed/delivered timestamps plus SLA vs actual minutes.'
  }
];

export default async function PlatformReportsPage() {
  await requireSuperAdmin();
  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Pick a date range, then download the CSV or XLSX for any report.
        </p>
      </header>
      <ReportRangePicker apiBase="/api/platform/reports" reports={REPORTS} />
    </div>
  );
}
