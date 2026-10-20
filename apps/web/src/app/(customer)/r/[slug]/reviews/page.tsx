import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { loadPublicReviews } from '@/server/reviews/public';
import { Aggregate } from '../reviews-section';
import { ReviewsList } from './reviews-list';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { name: true } });
  return { title: r ? `Reviews · ${r.name}` : 'Reviews' };
}

export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!r) notFound();
  const data = await loadPublicReviews(r.id, { pageSize: 10 });
  return (
    <div className="container py-8 max-w-3xl">
      <Link href={`/r/${slug}`} className="text-sm text-muted-foreground hover:underline">&larr; {r.name}</Link>
      <h1 className="display mt-2 text-2xl md:text-3xl font-semibold">Reviews</h1>
      <div className="mt-3"><Aggregate data={data.aggregate} /></div>
      <ReviewsList slug={slug} initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
