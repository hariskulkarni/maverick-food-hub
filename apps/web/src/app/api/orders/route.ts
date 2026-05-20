import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { placeOrder } from '@/server/orders';
import { PaymentMethod, FulfillmentType } from '@prisma/client';
import { log } from '@/server/log';

const Body = z.object({
  branchId: z.string(),
  addressId: z.string().optional(),
  items: z.array(z.object({
    menuItemId: z.string().optional(),
    comboId: z.string().optional(),
    quantity: z.number().int().positive(),
    notes: z.string().optional(),
    // Variant (size) + modifier (add-on) selections. Server re-prices from
    // these — client-sent prices are never trusted.
    selectedVariantId: z.string().optional().nullable(),
    selectedModifierOptionIds: z.array(z.string()).optional()
  })).min(1),
  couponCode: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  customerNotes: z.string().optional(),
  walletApply: z.number().nonnegative().optional(),
  loyaltyApply: z.number().nonnegative().optional(),
  // New fulfillment fields. All optional — when absent placeOrder defaults to
  // DELIVERY, preserving the existing behaviour exactly. The server enforces
  // every business rule (reservation ownership, deposit credit, scheduling
  // window); these just carry the customer's choice through.
  fulfillmentType: z.nativeEnum(FulfillmentType).optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
  reservationId: z.string().optional().nullable()
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
      loyaltyApply: body.loyaltyApply,
      fulfillmentType: body.fulfillmentType,
      scheduledFor: body.scheduledFor,
      reservationId: body.reservationId
    });
    return Response.json({
      orderId: result.order.id,
      orderCode: result.order.code,
      fulfillmentType: result.order.fulfillmentType,
      pickupCode: result.order.pickupCode,
      scheduledFor: result.order.scheduledFor,
      payment: result.payment
    });
  } catch (err) {
    const message = (err as Error).message || 'Failed to place order';
    log.error({ err: message, body, stack: (err as Error).stack }, 'placeOrder failed');
    return Response.json({ error: 'Failed to place order', detail: message }, { status: 500 });
  }
}
