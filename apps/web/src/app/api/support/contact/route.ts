/**
 * POST /api/support/contact — the public /contact form.
 *
 * Creates a SupportTicket (the same queue ops work in /platform/support), so no
 * new inbox is needed. Works signed-out: name + email are kept in the ticket
 * message because SupportTicket has no contact columns. Rate-limited per IP and
 * per email; a hidden `website` honeypot silently drops bots.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { TicketType, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { rateLimit } from '@/server/http/rate-limit';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOPICS = {
  order: { label: 'Help with an order', type: TicketType.OTHER },
  refund: { label: 'Refund or payment', type: TicketType.REFUND_REQUEST },
  account: { label: 'My account', type: TicketType.OTHER },
  restaurant: { label: 'Restaurant partnership', type: TicketType.OTHER },
  rider: { label: 'Riding with us', type: TicketType.OTHER },
  other: { label: 'Something else', type: TicketType.OTHER }
} as const;

const Body = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(80),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(120),
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]),
  message: z.string().trim().min(10, 'Please write at least 10 characters.').max(2000),
  website: z.string().max(200).optional() // honeypot — humans leave it empty
});

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'contact-form', limit: 5, windowMs: 10 * 60_000 });
  if (!rl.ok) return rl.response;

  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const data = parsed;

  // Bot filled the hidden field: pretend success, store nothing.
  if (data.website) return Response.json({ ok: true }, { status: 201 });

  const perEmail = await rateLimit(req, { name: 'contact-form-email', limit: 3, windowMs: 60 * 60_000, key: data.email, ignoreIp: true });
  if (!perEmail.ok) return perEmail.response;

  const session = await auth().catch(() => null);
  const customerId = session?.user?.role === Role.CUSTOMER ? session.user.id : undefined;

  const topic = TOPICS[data.topic];
  const ticket = await prisma.supportTicket.create({
    data: {
      type: topic.type,
      customerId,
      message: `[Contact form] ${topic.label}\nFrom: ${data.name} <${data.email}>\n\n${data.message}`
    },
    select: { id: true }
  });
  return Response.json({ ok: true, ticketId: ticket.id }, { status: 201 });
}
