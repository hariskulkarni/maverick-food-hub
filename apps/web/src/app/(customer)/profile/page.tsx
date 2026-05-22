import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { money } from '@/lib/utils';
import { Gift, ArrowRight } from 'lucide-react';
import { remainingBalance } from '@/server/signup-bonus';
import { LogoutButton } from './logout-button';

export const metadata = { title: 'Profile' };
// Always render the live profile (addresses, balances) from the DB.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/profile');

  const [user, wallet, loyalty, addresses, recentOrders, referrals, signupGrant] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    prisma.wallet.findUnique({ where: { userId: session.user.id } }),
    prisma.loyaltyAccount.findUnique({ where: { userId: session.user.id } }),
    prisma.address.findMany({ where: { userId: session.user.id }, orderBy: { isDefault: 'desc' } }),
    prisma.order.findMany({ where: { customerId: session.user.id }, orderBy: { placedAt: 'desc' }, take: 5 }),
    prisma.referral.findMany({ where: { referrerId: session.user.id } }),
    (prisma as any).signupBonusGrant.findUnique({ where: { userId: session.user.id } })
  ]);

  const bonus = signupGrant ? {
    balance: remainingBalance({
      id: signupGrant.id, userId: signupGrant.userId,
      totalAmount:   Number(signupGrant.totalAmount),
      perOrderCap:   Number(signupGrant.perOrderCap),
      usedAmount:    Number(signupGrant.usedAmount),
      pendingAmount: Number(signupGrant.pendingAmount),
      remainingOrders: signupGrant.remainingOrders,
      expiresAt: signupGrant.expiresAt, revokedAt: signupGrant.revokedAt
    }),
    remainingOrders: signupGrant.remainingOrders,
    revoked: !!signupGrant.revokedAt
  } : null;

  return (
    <div className="container py-6 md:py-8 grid gap-6 md:grid-cols-[280px_1fr]">
      <aside className="space-y-3">
        {/* Avatar + name header. Tighter 64px circle on mobile (size-16), more
            generous breathing room on desktop. */}
        <Card className="rounded-2xl md:rounded-xl">
          <CardContent className="p-4 md:p-5 flex md:block items-center gap-4">
            <div className="grid size-16 md:hidden place-items-center rounded-full bg-primary/15 text-primary text-xl font-semibold shrink-0">
              {(user?.name ?? user?.phone ?? '?').toString().trim().charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-muted-foreground">Hello,</div>
              <div className="display text-lg md:text-xl font-semibold truncate">{user?.name ?? user?.phone}</div>
              <div className="text-sm text-muted-foreground mt-1 truncate">{user?.phone}</div>
            </div>
            <div className="hidden md:grid mt-4 grid-cols-2 gap-3">
              <Stat label="Wallet" value={money(Number(wallet?.balance ?? 0))} />
              <Stat label="Loyalty" value={`${loyalty?.pointsBalance ?? 0} pt`} />
            </div>
          </CardContent>
        </Card>

        {/* Wallet/Loyalty pair — exposed on mobile as a 2-up grid below the avatar card. */}
        <div className="grid md:hidden grid-cols-2 gap-3">
          <Stat label="Wallet" value={money(Number(wallet?.balance ?? 0))} />
          <Stat label="Loyalty" value={`${loyalty?.pointsBalance ?? 0} pt`} />
        </div>

        {/* Mobile: horizontal scroll-x tab rail with snap. Desktop: vertical
            stacked list (the original layout). */}
        <nav
          aria-label="Profile sections"
          className="-mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto md:overflow-visible no-scrollbar snap-x snap-mandatory md:snap-none"
        >
          <div className="flex md:flex-col md:grid md:gap-1 gap-2 md:gap-0 text-sm">
            {[
              { href: '/profile', label: 'Overview' },
              { href: '/orders', label: 'My orders' },
              { href: '/profile/addresses', label: 'Addresses' },
              { href: '/profile/favorites', label: 'Favorites' },
              { href: '/profile/rewards', label: 'Rewards' },
              ...(bonus && !bonus.revoked ? [{ href: '/profile/signup-bonus', label: 'Signup Bonus' }] : []),
              { href: '/profile/referrals', label: 'Referrals' },
              { href: '/profile/security', label: 'Security & sessions' }
            ].map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className="shrink-0 snap-start inline-flex items-center min-h-10 md:min-h-0 rounded-full md:rounded-md border md:border-0 bg-card md:bg-transparent px-4 py-2 md:px-3 md:py-2 font-medium md:font-normal hover:bg-accent md:hover:bg-accent transition-colors"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </nav>
        <LogoutButton />
      </aside>

      <section className="space-y-4">
        {bonus && !bonus.revoked && bonus.balance > 0 && (
          <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-warning/5 to-card">
            <CardContent className="p-5">
              <Link href="/profile/signup-bonus" className="flex items-center justify-between gap-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary shrink-0">
                    <Gift className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">Signup Bonus</h3>
                      <Badge variant="success" className="text-[10px]">Active</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {money(bonus.balance)} balance · {bonus.remainingOrders} order{bonus.remainingOrders === 1 ? '' : 's'} left
                    </p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
              </Link>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold">Saved addresses</h3>
            {addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">No addresses yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {addresses.slice(0, 3).map((a) => (
                  <li key={a.id} className="rounded-lg border p-3">
                    <div className="font-medium text-sm">{a.label}</div>
                    <div className="text-sm text-muted-foreground">{a.line1}, {a.city} {a.postalCode}</div>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" className="mt-3" asChild><Link href="/profile/addresses">Manage addresses</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Recent orders</h3>
              <Link href="/orders" className="text-sm text-primary hover:underline">View all</Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-2">No orders yet. Browse the menu and order something delicious.</p>
            ) : (
              <ul className="mt-3 divide-y">
                {recentOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-3">
                    <div>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:text-primary">{o.code}</Link>
                      <div className="text-xs text-muted-foreground">{o.status} · {new Date(o.placedAt).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="text-sm font-semibold">{money(o.total as any)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
