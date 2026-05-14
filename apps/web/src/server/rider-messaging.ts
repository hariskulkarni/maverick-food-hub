/**
 * Rider ⇄ staff messaging helpers.
 *
 * Conversation model: each rider has at most ONE conversation with platform
 * ops (`party = SUPER_ADMIN`, restaurantId null) and one per restaurant
 * (`party = ADMIN`, restaurantId set). Conversations are find-or-created on
 * the first message from either side.
 *
 * `route.ts` files may only export HTTP handlers + config, so every bit of
 * shared logic for the messaging feature lives here.
 */
import { prisma } from './db';
import { publish } from './realtime';
import type {
  RiderConversation,
  RiderConversationMessage,
  RiderConversationParty,
  RiderMessageSender,
} from '@prisma/client';

const MAX_BODY = 4000;

/**
 * Find (or create) the single conversation between a rider and a given staff
 * party. For `party = ADMIN` a `restaurantId` is required and scopes the
 * conversation to that restaurant; for `party = SUPER_ADMIN` it must be null.
 */
export async function findOrCreateConversation(args: {
  riderId: string;
  party: RiderConversationParty;
  restaurantId?: string | null;
  subject?: string | null;
}): Promise<RiderConversation> {
  const restaurantId = args.party === 'ADMIN' ? args.restaurantId ?? null : null;
  if (args.party === 'ADMIN' && !restaurantId) {
    throw new Error('restaurantId is required for an ADMIN conversation');
  }

  const existing = await prisma.riderConversation.findFirst({
    where: { riderId: args.riderId, party: args.party, restaurantId },
  });
  if (existing) return existing;

  return prisma.riderConversation.create({
    data: {
      riderId: args.riderId,
      party: args.party,
      restaurantId,
      subject: args.subject ?? null,
    },
  });
}

type ConversationWithExtras = RiderConversation & {
  messages?: RiderConversationMessage[];
  rider?: {
    id: string;
    user?: { name: string | null; phone: string | null; avatarUrl: string | null } | null;
  } | null;
  _count?: { messages: number };
};

/**
 * JSON-safe shape for a conversation row. `viewer` controls which side's
 * unread counter is computed ('rider' counts messages unread by the rider,
 * 'staff' counts messages unread by staff).
 */
export function serializeConversation(
  c: ConversationWithExtras,
  viewer: 'rider' | 'staff'
) {
  const messages = c.messages ?? [];
  const sorted = messages
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const unreadCount = messages.filter((m) =>
    viewer === 'rider' ? !m.readByRider : !m.readByStaff
  ).length;

  return {
    id: c.id,
    riderId: c.riderId,
    party: c.party,
    restaurantId: c.restaurantId,
    subject: c.subject,
    lastMessageAt: c.lastMessageAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count?.messages ?? messages.length,
    unreadCount,
    lastMessage: last ? serializeMessage(last) : null,
    messages: sorted.map(serializeMessage),
    rider: c.rider
      ? {
          id: c.rider.id,
          name: c.rider.user?.name ?? null,
          phone: c.rider.user?.phone ?? null,
          avatarUrl: c.rider.user?.avatarUrl ?? null,
        }
      : null,
  };
}

/** JSON-safe shape for a single message. */
export function serializeMessage(m: RiderConversationMessage) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    senderName: m.senderName,
    body: m.body,
    readByRider: m.readByRider,
    readByStaff: m.readByStaff,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Append a message to a conversation. Bumps `lastMessageAt`, marks the message
 * read for the side that sent it (and unread for the other side), and pushes a
 * realtime `message:new` event on the rider's channel so any side can react.
 */
export async function postMessage(
  conversationId: string,
  sender: RiderMessageSender,
  senderName: string | null,
  body: string
): Promise<RiderConversationMessage> {
  const text = body.trim().slice(0, MAX_BODY);
  if (!text) throw new Error('Message body cannot be empty');

  const conversation = await prisma.riderConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, riderId: true },
  });
  if (!conversation) throw new Error('Conversation not found');

  const fromRider = sender === 'RIDER';

  const [message] = await prisma.$transaction([
    prisma.riderConversationMessage.create({
      data: {
        conversationId,
        sender,
        senderName,
        body: text,
        // The sender has, by definition, "read" their own message.
        readByRider: fromRider,
        readByStaff: !fromRider,
      },
    }),
    prisma.riderConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  publish(`rider:${conversation.riderId}`, {
    // The realtime event union in @/server/realtime doesn't (yet) include a
    // messaging kind; the channel + payload are intentionally additive.
    kind: 'message:new',
    conversationId,
  } as any);

  return message;
}
