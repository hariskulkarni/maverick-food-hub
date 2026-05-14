import Link from 'next/link';
import { brand } from '@/lib/brand';

export const metadata = { title: 'Rider app' };

export default function RiderAppPage() {
  return (
    <div className="container py-12 max-w-3xl space-y-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">Riders</div>
      <h1 className="display text-4xl font-semibold">Riders — get the {brand.name} app</h1>
      <p className="text-lg text-muted-foreground">
        Delivery riders now work entirely from our native Android app — picking up shifts,
        accepting orders, and tracking earnings all happen there.
      </p>
      <p>
        The old web rider dashboard has been retired. If you landed here from an old link or
        bookmark, install the native app to get back to work. Already a rider? Just open the
        app on your phone — there&apos;s nothing to set up here.
      </p>
      <p>
        Want to ride with us?{' '}
        <Link href="/signup/rider" className="text-primary underline-offset-4 hover:underline">
          Apply to become a rider
        </Link>
        .
      </p>
    </div>
  );
}
