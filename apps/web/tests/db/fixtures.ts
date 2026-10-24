/**
 * Minimal real-DB fixtures for Flavrly PG tests. Every call uses fresh ids, so tests never
 * depend on each other and never need to delete rows (PgFinancialEvent is append-only).
 */
import { randomUUID } from 'node:crypto';
import { OrderStatus, PaymentMethod, PgAttemptState, PgBankSource, PgBankTxnStatus, PrismaClient } from '@prisma/client';
import { prisma } from '@/server/db';

export { prisma };
export const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);

export async function makeAccount(db: PrismaClient = prisma) {
  const id = uid();
  const owner = await db.user.create({ data: { email: `owner-${id}@example.test`, role: 'ADMIN' } });
  const customer = await db.user.create({ data: { email: `cust-${id}@example.test` } });
  const restaurant = await db.restaurant.create({ data: { slug: `r-${id}`, name: `R ${id}`, ownerUserId: owner.id } });
  const branch = await db.branch.create({
    data: { restaurantId: restaurant.id, name: 'Main', slug: `b-${id}`, line1: 'x', city: 'Pune', postalCode: '411001' },
  });
  const account = await db.pgReceivingAccount.create({
    data: {
      restaurantId: restaurant.id,
      gatewayMerchantId: `m-${id}`,
      vpa: `shop${id}@bank`,
      vpaNormalized: `shop${id}@bank`,
      accountFingerprint: `fp-${id}`,
      legalEntityName: 'Test Foods Pvt Ltd',
      status: 'VERIFIED',
    },
  });
  return { restaurant, branch, customer, account };
}

export type Account = Awaited<ReturnType<typeof makeAccount>>;

/** Order (PAYMENT_PENDING) + youpi Payment (PENDING) + PgPaymentAttempt. */
export async function makeAttempt(
  acc: Account,
  opts: {
    amountPaise?: number;
    state?: PgAttemptState;
    observedUtr?: string | null;
    orderId?: string;
    createdAt?: Date;
  } = {},
) {
  const amountPaise = opts.amountPaise ?? 25000;
  const amount = `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, '0')}`;
  const orderId =
    opts.orderId ??
    (
      await prisma.order.create({
        data: {
          code: `ORD-${uid()}`,
          branchId: acc.branch.id,
          customerId: acc.customer.id,
          status: OrderStatus.PAYMENT_PENDING,
          subtotal: amount,
          total: amount,
          paymentMethod: PaymentMethod.RAZORPAY,
        },
      })
    ).id;
  const payment = await prisma.payment.create({
    data: { orderId, method: PaymentMethod.RAZORPAY, amount, providerName: 'youpi', providerRef: `yp_${uid()}` },
  });
  const key = `${orderId}-${uid()}`;
  const attempt = await prisma.pgPaymentAttempt.create({
    data: {
      paymentId: payment.id,
      orderId,
      restaurantId: acc.restaurant.id,
      receivingAccountId: acc.account.id,
      attemptKey: key,
      idempotencyKey: key,
      gatewayMerchantId: acc.account.gatewayMerchantId,
      gatewayPaymentId: payment.providerRef,
      expectedAmountPaise: amountPaise,
      state: opts.state ?? PgAttemptState.OBSERVED,
      observedUtr: opts.observedUtr === undefined ? `UTR${uid().toUpperCase()}` : opts.observedUtr,
      createdAt: opts.createdAt,
    },
  });
  return { orderId, payment, attempt };
}

/** Insert a bank credit directly (bypasses ingest; use ingest functions when testing ingest). */
export async function makeCredit(
  acc: Account,
  opts: { amountPaise: number; reference: string; valueAt?: Date; source?: PgBankSource; status?: PgBankTxnStatus },
) {
  return prisma.pgBankTransaction.create({
    data: {
      receivingAccountId: acc.account.id,
      direction: 'CREDIT',
      amountPaise: opts.amountPaise,
      bankReference: opts.reference,
      valueAt: opts.valueAt ?? new Date(),
      source: opts.source ?? PgBankSource.STATEMENT_IMPORT,
      sourceRowHash: uid(),
      status: opts.status ?? PgBankTxnStatus.UNMATCHED,
    },
  });
}
