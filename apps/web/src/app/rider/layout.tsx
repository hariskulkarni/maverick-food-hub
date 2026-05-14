import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { brand } from '@/lib/brand';
import { AccountMenu } from './account-menu';
import { ServiceWorkerInit } from './sw-init';

export default async function RiderLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'RIDER') redirect('/login?next=/rider&mode=rider');
  return (
    <div className="min-h-dvh bg-background">
      <ServiceWorkerInit />
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-4 max-w-md mx-auto">
        {/* Single branded title — "<brand> · Rider" — keeps the rider WebView
            visually distinct from the customer app. */}
        <Link href="/rider" className="display text-lg font-bold text-primary truncate">
          {brand.name} <span className="text-muted-foreground font-medium">· Rider</span>
        </Link>
        <AccountMenu
          name={session.user.name ?? session.user.phone ?? 'Rider'}
          phone={session.user.phone ?? null}
          email={session.user.email ?? null}
        />
      </header>
      <main className="p-4 max-w-md mx-auto">{children}</main>
      {/* Bottom tab bar — rider-only surfaces. No customer tabs. */}
      <nav className="fixed bottom-0 inset-x-0 border-t bg-card max-w-md mx-auto grid grid-cols-4 text-center text-xs">
        <Link href="/rider"          className="py-3 hover:bg-accent">Active</Link>
        <Link href="/rider/pool"     className="py-3 hover:bg-accent">Pool</Link>
        <Link href="/rider/history"  className="py-3 hover:bg-accent">History</Link>
        <Link href="/rider/earnings" className="py-3 hover:bg-accent">Earnings</Link>
      </nav>
      <div className="h-20" />
    </div>
  );
}
