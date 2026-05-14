import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { brand } from '@/lib/brand';
import { LogoutButton } from '../(customer)/profile/logout-button';

export default async function KitchenLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !['KITCHEN', 'ADMIN'].includes(session.user.role)) redirect('/login?next=/kitchen&mode=admin');
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-card px-4">
        <Link href="/kitchen" className="display text-lg font-bold text-primary">{brand.name}</Link>
        <span className="text-xs text-muted-foreground">Kitchen</span>
        <span className="ml-auto text-sm">{session.user.name}</span>
        <LogoutButton />
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
