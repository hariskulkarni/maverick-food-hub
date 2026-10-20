import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { brand } from '@/lib/brand';
import { IssueForm } from './issue-form';

export const metadata = {
  title: 'Help with an order',
  description: `Report a problem with your ${brand.name} order.`
};

export default async function HelpPage({ searchParams }: { searchParams: { order?: string } }) {
  const order = searchParams.order?.slice(0, 64) ?? '';
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=${encodeURIComponent(`/help${order ? `?order=${order}` : ''}`)}`);
  }
  return (
    <div className="container py-10 md:py-14 max-w-xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Help</div>
      <h1 className="display mt-2 text-3xl font-semibold">Something wrong with your order?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tell us what happened and our team will get back to you. See our{' '}
        <a href="/refunds" className="text-primary underline">
          refund policy
        </a>{' '}
        for how refunds work.
      </p>
      <IssueForm orderId={order} />
    </div>
  );
}
