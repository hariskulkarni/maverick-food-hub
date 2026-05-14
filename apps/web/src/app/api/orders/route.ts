import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { placeOrder } from '@/server/orders';
import { PaymentMethod } from '@prisma/client';
import { log } from '@/server/log';

const Body = z.object({
  branchId: z.string(),
  addressId: z.string().optional(),
  items: z.array(z.object({ menuItemId: z.string().optional(), comboId: z.string().optional(), quantity: z.number().int().positive(), notes: z.string().optional() })).min(1),
  couponCode: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  customerNotes: z.string().optional(),
  walletApply: z.number().nonnegative().optional(),
  loyaltyApply: z.number().nonnegative().optional()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (err as Error).message;
    log.warn({ err: message }, 'placeOrder body invalid');
    return Response.json({ error: 'Invalid request', detail: message }, { status: 400 });
  }

  try {
    const result = await placeOrder({
      branchId: body.branchId,
      customerId: session.user.id,
      addressId: body.addressId,
      items: body.items,
      couponCode: body.couponCode,
      paymentMethod: body.paymentMethod,
      customerNotes: body.customerNotes,
      walletApply: body.walletApply,
      loyaltyApply: body.loyaltyApply
    });
    return Response.json({ orderId: result.order.id, orderCode: result.order.code, payment: result.payment });
  } catch (err) {
    const message = (err as Error).message || 'Failed to place order';
    log.error({ err: message, body, stack: (err as Error).stack }, 'placeOrder failed');
    return Response.json({ error: 'Failed to place order', detail: message }, { status: 500 });
  }
}
