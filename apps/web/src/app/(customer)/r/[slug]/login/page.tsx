import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { BrandMark } from '@/components/brand-mark';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="gradient-hero">
      <div className="container py-6 md:py-10 max-w-md">
        {/* Brand wordmark link back to the platform home — small, top-left. */}
        <div className="mb-6">
          <Link href={`/r/${restaurant.slug}`} className="inline-flex items-center">
            <BrandMark className="text-base" />
          </Link>
        </div>

        {/* Hero: logo + name + subhead */}
        <div className="text-center mb-6 reveal">
          {restaurant.logoUrl ? (
            <div className="mx-auto mb-3 size-20 rounded-2xl overflow-hidden border-2 border-background shadow-xl bg-card relative">
              <Image src={restaurant.logoUrl} alt={restaurant.name} fill sizes="80px" className="object-cover" />
            </div>
          ) : null}
          <h1 className="display text-2xl md:text-3xl font-semibold tracking-tight">{restaurant.name}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Sign in to order from {restaurant.name}
          </p>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <CustomerLoginClient slug={restaurant.slug} googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Restaurant staff?{' '}
          <Link href={`/r/${restaurant.slug}/staff`} className="text-primary underline">
            Sign in at /r/{restaurant.slug}/staff
          </Link>
        </p>
      </div>
    </div>
  );
}
