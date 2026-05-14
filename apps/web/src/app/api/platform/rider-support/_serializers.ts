/**
 * Serializers for RiderSupportTicket / RiderSupportMessage rows. Live outside
 * `route.ts` because a Next.js route file may only export HTTP handlers +
 * route config.
 */
export function serializeMessage(m: any) {
  return {
    id: m.id,
    ticketId: m.ticketId,
    fromRider: m.fromRider,
    authorName: m.authorName ?? null,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

export function serializeTicket(t: any) {
  const messages = (t.messages ?? []).map(serializeMessage);
  const last = messages.length ? messages[messages.length - 1].createdAt : t.updatedAt.toISOString();
  return {
    id: t.id,
    riderId: t.riderId,
    subject: t.subject,
    category: t.category,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    messageCount: t._count?.messages ?? messages.length,
    lastActivityAt: last,
    messages,
    rider: {
      id: t.rider?.id ?? t.riderId,
      name: t.rider?.user?.name ?? null,
      phone: t.rider?.user?.phone ?? null,
    },
  };
}
