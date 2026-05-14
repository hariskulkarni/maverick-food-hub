/**
 * Admin · Messages
 *
 * Restaurant-admin ⇄ rider chat. Server component resolves the ADMIN's
 * restaurant and hands the client component an initial snapshot of
 * conversations + the rider roster; the client handles thread loading,
 * sending, and ~4s polling of the open thread.
 */
import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { serializeConversation } from '@/server/rider-messaging';
import { AdminMessagesClient } from './messages-client';

export const metadata = { title: 'Admin · Messages' };
export const dynamic = 'force-dynamic';

export default async function AdminMessagesPage() {
  const restaurant = await requireRestaurant();

  const [conversations, dedicated, deliveredFor] = await Promise.all([
    prisma.riderConversation.findMany({
      where: { party: 'ADMIN', restaurantId: restaurant.id },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        rider: { include: { user: { select: { name: true, phone: true, avatarUrl: true } } } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.riderProfile.findMany({
      where: { dedicatedRestaurantId: restaurant.id },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    }),
    prisma.riderProfile.findMany({
      where: { assignments: { some: { order: { branch: { restaurantId: restaurant.id } } } } },
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
    }),
  ]);

  const byId = new Map<string, { dedicated: boolean; r: (typeof dedicated)[number] }>();
  for (const r of dedicated) byId.set(r.id, { dedicated: true, r });
  for (const r of deliveredFor) if (!byId.has(r.id)) byId.set(r.id, { dedicated: false, r });

  const riders = [...byId.values()]
    .map(({ dedicated, r }) => ({
      id: r.id,
      name: r.user?.name ?? null,
      phone: r.user?.phone ?? null,
      avatarUrl: r.user?.avatarUrl ?? null,
      isOnline: r.isOnline,
      dedicated,
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-3xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Chat directly with riders dedicated to {restaurant.name} or who have delivered for you.
        </p>
      </header>

      <AdminMessagesClient
        restaurantName={restaurant.name}
        initialConversations={JSON.parse(
          JSON.stringify(conversations.map((c) => serializeConversation(c, 'staff')))
        )}
        initialRiders={JSON.parse(JSON.stringify(riders))}
      />
    </div>
  );
}
