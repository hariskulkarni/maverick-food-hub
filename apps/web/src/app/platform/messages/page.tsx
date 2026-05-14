/**
 * Platform · Messages
 *
 * Super-admin ⇄ rider chat. Server component loads every SUPER_ADMIN-party
 * conversation plus the full rider roster, so platform ops can reach any
 * rider. The client component handles thread loading, sending, and ~4s
 * polling of the open thread.
 */
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { serializeConversation } from '@/server/rider-messaging';
import { PlatformMessagesClient } from './messages-client';

export const metadata = { title: 'Platform · Messages' };
export const dynamic = 'force-dynamic';

export default async function PlatformMessagesPage() {
  await requireSuperAdmin();

  const [conversations, riders] = await Promise.all([
    prisma.riderConversation.findMany({
      where: { party: 'SUPER_ADMIN' },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        rider: { include: { user: { select: { name: true, phone: true, avatarUrl: true } } } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.riderProfile.findMany({
      include: { user: { select: { name: true, phone: true, avatarUrl: true } } },
      orderBy: [{ isOnline: 'desc' }, { totalDeliveries: 'desc' }],
    }),
  ]);

  const riderList = riders.map((r) => ({
    id: r.id,
    name: r.user?.name ?? null,
    phone: r.user?.phone ?? null,
    avatarUrl: r.user?.avatarUrl ?? null,
    isOnline: r.isOnline,
  }));

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-3xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Direct chat between platform operations and any rider on the platform.
        </p>
      </header>

      <PlatformMessagesClient
        initialConversations={JSON.parse(
          JSON.stringify(conversations.map((c) => serializeConversation(c, 'staff')))
        )}
        initialRiders={JSON.parse(JSON.stringify(riderList))}
      />
    </div>
  );
}
