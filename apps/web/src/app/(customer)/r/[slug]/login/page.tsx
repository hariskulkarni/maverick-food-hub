import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { CustomerAuthShell } from '@/components/auth/customer/customer-auth-shell';
import { CustomerAuthLegal } from '@/components/auth/customer/customer-phone-flow';
import { CustomerLoginClient } from './login-client';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug } });
  return { title: r ? `Sign in to ${r.name}` : 'Sign in' };
}

export default async function RestaurantCustomerLoginPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, logoUrl: true, status: true }
  });
  if (!restaurant || restaurant.status !== 'ACTIVE') return notFound();

  return (
    <CustomerAuthShell
      restaurant={{ name: restaurant.name, logoUrl: restaurant.logoUrl, slug: restaurant.slug }}
      homeHref={`/r/${restaurant.slug}`}
    >
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight">Sign in to order</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use your mobile number — it only takes a moment.</p>
        </div>
        <CustomerLoginClient
          slug={restaurant.slug}
          googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
        />
        <CustomerAuthLegal />
        <div className="flex flex-wrap items-center justify-center gap-x-4 border-t border-border pt-4 text-sm text-muted-foreground">
          <Link href={`/r/${restaurant.slug}/staff`} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
            Restaurant staff sign in
          </Link>
          <Link href="/forgot-password" className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
    </CustomerAuthShell>
  );
}
