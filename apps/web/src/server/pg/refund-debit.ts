/**
 * P2 refund reconciliation: a completed manual bank refund (PgRefundRecord with a human-entered bank
 * reference) is linked to the DEBIT row of the restaurant's statement that carries the same reference
 * and exact amount on the same receiving account. Linking is by reference + amount only, never guessed:
 * a mismatch leaves the DEBIT UNMATCHED and the refund unlinked, both visible. Whichever arrives second
 * (refund completion or statement import) makes the link. The DEBIT row becomes ALLOCATED.
 */

import { appendFinancialEvent, type Tx } from './ledger';
import { normalizeBankReference } from './bank-source';

async function link(
  tx: Tx,
  rec: { id: string; refundId: string; attemptId: string | null; amountPaise: number },
  txn: { id: string; amountPaise: number },
  ctx: { restaurantId: string | null; orderId: string | null; actorId: string | null },
): Promise<boolean> {
  const r = await tx.pgRefundRecord.updateMany({ where: { id: rec.id, bankTransactionId: null }, data: { bankTransactionId: txn.id } });
  if (r.count !== 1) return false;
  const t = await tx.pgBankTransaction.updateMany({ where: { id: txn.id, status: 'UNMATCHED', direction: 'DEBIT' }, data: { status: 'ALLOCATED' } });
  if (t.count !== 1) throw new Error('refund debit link: bank row changed concurrently');
  await appendFinancialEvent(tx, {
    kind: 'REFUND_BANK_LINKED',
    restaurantId: ctx.restaurantId,
    attemptId: rec.attemptId,
    orderId: ctx.orderId,
    bankTransactionId: txn.id,
    refundId: rec.refundId,
    amountPaise: txn.amountPaise,
    actorId: ctx.actorId,
    dedupeKey: `REFUND_BANK_LINKED:${rec.id}`,
  });
  return true;
}

/** After a refund is completed: link the statement DEBIT if it is already imported. */
export async function linkRefundToDebit(tx: Tx, refundRecordId: string, actorId: string): Promise<boolean> {
  const rec = await tx.pgRefundRecord.findUnique({ where: { id: refundRecordId }, include: { refund: { select: { orderId: true, status: true } } } });
  if (!rec?.bankReference || rec.bankTransactionId || rec.refund.status !== 'COMPLETED' || !rec.attemptId) return false;
  const a = await tx.pgPaymentAttempt.findUnique({ where: { id: rec.attemptId }, select: { receivingAccountId: true, restaurantId: true } });
  if (!a) return false;
  const txn = await tx.pgBankTransaction.findUnique({
    where: {
      receivingAccountId_direction_bankReference: { receivingAccountId: a.receivingAccountId, direction: 'DEBIT', bankReference: normalizeBankReference(rec.bankReference) },
    },
  });
  if (!txn || txn.status !== 'UNMATCHED' || txn.amountPaise !== rec.amountPaise) return false;
  return link(tx, rec, txn, { restaurantId: a.restaurantId, orderId: rec.refund.orderId, actorId });
}

/** After a DEBIT row is ingested: link the completed refund that recorded this reference. */
export async function linkDebitToRefund(tx: Tx, bankTransactionId: string, actorId: string | null): Promise<boolean> {
  const txn = await tx.pgBankTransaction.findUnique({ where: { id: bankTransactionId }, include: { receivingAccount: { select: { restaurantId: true } } } });
  if (!txn || txn.direction !== 'DEBIT' || txn.status !== 'UNMATCHED') return false;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "PgRefundRecord" r
    JOIN "Refund" f ON f.id = r."refundId"
    JOIN "PgPaymentAttempt" a ON a.id = r."attemptId"
    WHERE a."receivingAccountId" = ${txn.receivingAccountId}
      AND f.status = 'COMPLETED' AND r."bankTransactionId" IS NULL AND r."amountPaise" = ${txn.amountPaise}
      AND (CASE WHEN r."bankReference" ~ '^[0-9]+$' THEN regexp_replace(r."bankReference", '^0+(?=[0-9])', '') ELSE r."bankReference" END) = ${txn.bankReference}
    LIMIT 2`;
  if (rows.length !== 1) return false;
  const rec = await tx.pgRefundRecord.findUniqueOrThrow({ where: { id: rows[0].id }, include: { refund: { select: { orderId: true } } } });
  return link(tx, rec, txn, { restaurantId: txn.receivingAccount.restaurantId, orderId: rec.refund.orderId, actorId });
}

