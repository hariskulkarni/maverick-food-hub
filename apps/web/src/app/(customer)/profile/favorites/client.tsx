'use client';

/**
 * Renders the favorites grids and wires the heart toggle so that an "un-favorite"
 * action removes the corresponding card from the list immediately (optimistic).
 * Server data is the source of truth on next navigation; we don't refetch here.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HeartButton } from '@/components/heart-button';
import { money } from '@/lib/utils';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { Store, UtensilsCrossed } from 'lucide-react';

export interface FavoriteRestaurantCard {
  id: string;
  name: string;
  slug: string;
  cuisine: string | null;
  logoUrl: string | null;
}

export interface FavoriteItemCard {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  isVeg: boolean;
  isAvailable: boolean;
  restaurantSlug: string;
  restaurantName: string;
}

export function FavoritesClient({
  restaurants: initialRestaurants,
  items: initialItems
}: {
  restaurants: FavoriteRestaurantCard[];
  items: FavoriteItemCard[];
}) {
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [items, setItems] = useState(initialItems);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Store className="size-3.5" /> Restaurants
            </div>
            <h2 className="display mt-1 text-2xl font-semibold">Favorite restaurants</h2>
          </div>
          <div className="text-xs text-muted-foreground">{restaurants.length} saved</div>
        </div>

        {restaurants.length === 0 ? (
          <EmptyRestaurants />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 reveal-stagger">
            {restaurants.map((r) => (
              <Card key={r.id} className="overflow-hidden card-lift">
                <CardContent className="p-0">
                  <Link href={`/r/${r.slug}`} className="block">
                    <div className="relative h-32 bg-muted overflow-hidden">
                      <Image
                        src={r.logoUrl || FOOD_FALLBACK}
                        alt={r.name}
                        fill
                        sizes="(min-width: 1024px) 33vw, 50vw"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                      <div className="absolute top-2 right-2">
                        <HeartButton
                          restaurantId={r.id}
                          initial
                          variant="glass"
                          size="sm"
                          onChange={(next) => {
                            if (!next) setRestaurants((prev) => prev.filter((x) => x.id !== r.id));
                          }}
                        />
                      </div>
                    </div>
                  </Link>
                  <div className="p-4">
                    <Link href={`/r/${r.slug}`} className="block">
                      <div className="font-semibold truncate hover:text-primary transition-colors">{r.name}</div>
                      {r.cuisine && (
                        <Badge variant="muted" className="mt-2">
                          {r.cuisine}
                        </Badge>
                      )}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <UtensilsCrossed className="size-3.5" /> Dishes
            </div>
            <h2 className="display mt-1 text-2xl font-semibold">Favorite dishes</h2>
          </div>
          <div className="text-xs text-muted-foreground">{items.length} saved</div>
        </div>

        {items.length === 0 ? (
          <EmptyDishes />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 reveal-stagger">
            {items.map((i) => (
              <Card key={i.id} className="overflow-hidden card-lift">
                <CardContent className="p-0">
                  <Link href={`/r/${i.restaurantSlug}`} className="block">
                    <div className="relative h-36 bg-muted overflow-hidden">
                      <Image
                        src={i.imageUrl || FOOD_FALLBACK}
                        alt={i.name}
                        fill
                        sizes="(min-width: 1024px) 33vw, 50vw"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                      <div className="absolute top-2 right-2">
                        <HeartButton
                          menuItemId={i.id}
                          initial
                          variant="glass"
                          size="sm"
                          onChange={(next) => {
                            if (!next) setItems((prev) => prev.filter((x) => x.id !== i.id));
                          }}
                        />
                      </div>
                      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded-sm border-[1.5px] bg-white/95 ${i.isVeg ? 'border-success' : 'border-destructive'}`}
                          title={i.isVeg ? 'Veg' : 'Non-veg'}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${i.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                        </span>
                        {!i.isAvailable && <Badge variant="muted">Unavailable</Badge>}
                      </div>
                    </div>
                  </Link>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/r/${i.restaurantSlug}`} className="font-semibold truncate hover:text-primary transition-colors block">
                          {i.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-muted-foreground truncate">at {i.restaurantName}</div>
                      </div>
                      <div className="font-semibold text-sm text-primary shrink-0">{money(i.price)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyRestaurants() {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8 text-center">
        <Store className="size-10 text-muted-foreground/60 mx-auto" />
        <h3 className="font-semibold mt-3">No favorite restaurants yet</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Tap the heart on any restaurant to save it here for one-tap reorder later.
        </p>
        <Button className="mt-4" asChild>
          <Link href="/restaurants">Browse restaurants</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyDishes() {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8 text-center">
        <UtensilsCrossed className="size-10 text-muted-foreground/60 mx-auto" />
        <h3 className="font-semibold mt-3">No favorite dishes yet</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          When you find a dish you love, tap its heart and we'll keep it here.
        </p>
        <Button className="mt-4" asChild>
          <Link href="/restaurants">Find a dish</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
