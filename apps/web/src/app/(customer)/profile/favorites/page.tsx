import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { FavoritesClient, type FavoriteRestaurantCard, type FavoriteItemCard } from './client';

export const metadata = { title: 'Favorites' };
export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/profile/favorites');

  const [favRestaurants, favItems] = await Promise.all([
    prisma.favoriteRestaurant.findMany({
      where: { userId: session.user.id },
      include: { restaurant: { select: { id: true, name: true, slug: true, cuisine: true, logoUrl: true, coverImageUrl: true } } },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.favoriteItem.findMany({
      where: { userId: session.user.id },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            imageUrl: true,
            isVeg: true,
            isAvailable: true,
            branch: { select: { restaurant: { select: { name: true, slug: true } } } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const restaurants: FavoriteRestaurantCard[] = favRestaurants.map((f) => ({
    id: f.restaurant.id,
    name: f.restaurant.name,
    slug: f.restaurant.slug,
    cuisine: f.restaurant.cuisine,
    logoUrl: f.restaurant.coverImageUrl ?? f.restaurant.logoUrl
  }));

  const items: FavoriteItemCard[] = favItems.map((f) => ({
    id: f.menuItem.id,
    name: f.menuItem.name,
    price: Number(f.menuItem.price),
    imageUrl: f.menuItem.imageUrl,
    isVeg: f.menuItem.isVeg,
    isAvailable: f.menuItem.isAvailable,
    restaurantSlug: f.menuItem.branch.restaurant.slug,
    restaurantName: f.menuItem.branch.restaurant.name
  }));

  return (
    <div className="container py-8">
      <header className="mb-8 reveal">
        <h1 className="display text-3xl font-semibold">Your favorites</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The restaurants and dishes you've hearted. Tap a heart again to remove.
        </p>
      </header>
      <FavoritesClient restaurants={restaurants} items={items} />
    </div>
  );
}
