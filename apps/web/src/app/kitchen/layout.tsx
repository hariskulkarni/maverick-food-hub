import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { brand } from '@/lib/brand';
import { LogoutButton } from '../(customer)/profile/logout-button';

export default async function KitchenLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !['KITCHEN', 'ADMIN'].includes(session.user.role)) redirect('/login?next=/kitchen&mode=admin');
  return (
    // Width-clamped so the order-board's horizontal column scroller
    // (which is the intended behaviour at the .overflow-x-auto child
    // level) never bleeds into a page-level horizontal scrollbar on
    // phones.
    <div className="min-h-dvh max-w-[100vw] overflow-x-hidden">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 sm:gap-4 border-b bg-card px-4">
        <Link href="/kitchen" className="display text-lg font-bold text-primary">{brand.name}</Link>
        <span className="text-xs text-muted-foreground">Kitchen</span>
        <Link href="/kitchen/training" className="ml-auto text-sm font-medium text-muted-foreground hover:text-foreground">Training</Link>
        <Link href="/kitchen/help" className="text-sm text-muted-foreground hover:text-foreground">Help</Link>
        <span className="hidden min-w-0 text-sm truncate sm:inline">{session.user.name}</span>
        {/* w-auto + shrink-0: the shared button is w-full (sidebar use), which
            pushed it past the right edge of a 390px phone header. */}
        <LogoutButton className="w-auto shrink-0" />
      </header>
      <main className="p-4 max-w-full">{children}</main>
    </div>
  );
}
