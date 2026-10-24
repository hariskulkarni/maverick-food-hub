/**
 * Durable, idempotent ingestion of bank movements into PgBankTransaction.
 *
 * - Identity: (receivingAccountId, direction, bankReference) — account-scoped, not global.
 *   Re-ingesting the same row is a no-op; a same-reference row with DIFFERENT amount/date is
 *   not overwritten and opens a DUPLICATE_CREDIT exception.
 * - Statement imports are deduplicated by file sha256 per account (PgStatementImport).
 * - MANUAL rows start PENDING_APPROVAL and need a DIFFERENT user to approve them before they
 *   become UNMATCHED (and therefore allocatable).
 * - Every insert/approval appends a PgFinancialEvent.
 * - Newly UNMATCHED credits are offered to the reconcile engine (tryAllocateBankTxn).
 */
import { createHash } from 'node:crypto';
import { PgBankSource, PgBankTxnStatus, PgExceptionKind, PgTxnDirection, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { appendFinancialEvent } from './ledger';
import { openException } from './exceptions';
import {
  normalizeBankReference,
  parseStatementCsv,
  redactNarration,
  type NormalizedBankTxn,
  type RejectedRow,
  type StatementColumnMapping,
} from './bank-source';
import { tryAllocateBankTxn } from './reconcile-engine';

export interface IngestResult {
  insertedIds: string[];
  duplicateCount: number;
  conflictCount: number;
}

export interface IngestOptions {
  importId?: string;
  /** Offer new UNMATCHED credits to the engine right away (default true). */
  autoAllocate?: boolean;
}

function assertRow(r: NormalizedBankTxn) {
  if (!Number.isSafeInteger(r.amountPaise) || r.amountPaise <= 0) throw new Error('amountPaise must be a positive integer');
  if (r.currency !== 'INR') throw new Error('only INR is supported');
  if (!r.bankReference || normalizeBankReference(r.bankReference) !== r.bankReference) {
    throw new Error('bankReference must be normalized and non-empty');
  }
  if (!(r.valueAt instanceof Date) || Number.isNaN(r.valueAt.getTime())) throw new Error('valueAt must be a valid Date');
}

export async function ingestBankTransactions(
  accountId: string,
  source: PgBankSource,
  rows: NormalizedBankTxn[],
  actor: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  if (!actor?.trim()) throw new Error('ingestBankTransactions: actor is required');
  const account = await prisma.pgReceivingAccount.findUnique({
    where: { id: accountId },
    select: { id: true, restaurantId: true },
  });
  if (!account) throw new Error(`ingestBankTransactions: receiving account ${accountId} not found`);
  rows.forEach(assertRow);

  const result: IngestResult = { insertedIds: [], duplicateCount: 0, conflictCount: 0 };
  const status = source === PgBankSource.MANUAL ? PgBankTxnStatus.PENDING_APPROVAL : PgBankTxnStatus.UNMATCHED;

  for (const r of rows) {
    await prisma.$transaction(async (tx) => {
      const key = { receivingAccountId: accountId, direction: r.direction, bankReference: r.bankReference };
      const { count } = await tx.pgBankTransaction.createMany({
        data: [
          {
            ...key,
            amountPaise: r.amountPaise,
            currency: r.currency,
            valueAt: r.valueAt,
            source,
            importId: opts.importId ?? null,
            sourceRowHash: r.sourceRowHash,
            status,
            counterpartyMasked: r.counterpartyMasked,
            narrationRedacted: r.narrationRedacted,
            enteredById: actor,
          },
        ],
        skipDuplicates: true,
      });
      const row = await tx.pgBankTransaction.findUniqueOrThrow({
        where: { receivingAccountId_direction_bankReference: key },
      });
      if (count > 0) {
        result.insertedIds.push(row.id);
        await appendFinancialEvent(tx, {
          kind: 'BANK_TXN_INGESTED',
          restaurantId: account.restaurantId,
          bankTransactionId: row.id,
          amountPaise: row.amountPaise,
          actorId: actor,
          dedupeKey: `BANK_TXN_INGESTED:${row.id}`,
          data: { source, direction: row.direction, status: row.status, importId: opts.importId ?? null },
        });
        return;
      }
      if (row.amountPaise === r.amountPaise && row.valueAt.getTime() === r.valueAt.getTime()) {
        result.duplicateCount++;
        return;
      }
      // Same account+direction+reference but different facts: never overwrite, escalate.
      result.conflictCount++;
      await openException(tx, {
        kind: PgExceptionKind.DUPLICATE_CREDIT,
        dedupeKey: `DUPLICATE_CREDIT:${row.id}:${r.sourceRowHash}`,
        restaurantId: account.restaurantId,
        receivingAccountId: accountId,
        bankTransactionId: row.id,
        amountPaise: r.amountPaise,
        detail: {
          reason: 'same_reference_different_facts',
          existingAmountPaise: row.amountPaise,
          incomingAmountPaise: r.amountPaise,
          existingValueAt: row.valueAt.toISOString(),
          incomingValueAt: r.valueAt.toISOString(),
          source,
        },
      });
    });
  }

  if (opts.autoAllocate !== false && status === PgBankTxnStatus.UNMATCHED) {
    for (const id of result.insertedIds) await tryAllocateBankTxn(id);
  }
  return result;
}

export interface StatementImportResult {
  importId: string;
  duplicateFile: boolean;
  insertedCount: number;
  duplicateCount: number;
  conflictCount: number;
  rejected: RejectedRow[];
}

/** Import a CSV statement once per (account, file sha256). Re-uploading the same file is a no-op. */
export async function importStatementCsv(input: {
  receivingAccountId: string;
  fileName: string;
  content: string;
  mapping: StatementColumnMapping;
  uploadedById: string;
}): Promise<StatementImportResult> {
  if (!input.uploadedById?.trim()) throw new Error('importStatementCsv: uploadedById is required');
  const fileSha256 = createHash('sha256').update(input.content, 'utf8').digest('hex');
  const existing = await prisma.pgStatementImport.findUnique({
    where: { receivingAccountId_fileSha256: { receivingAccountId: input.receivingAccountId, fileSha256 } },
  });
  if (existing) {
    return {
      importId: existing.id,
      duplicateFile: true,
      insertedCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      rejected: [],
    };
  }
  const parsed = parseStatementCsv(input.content, input.mapping);
  let imp: { id: string };
  try {
    imp = await prisma.pgStatementImport.create({
      data: {
        receivingAccountId: input.receivingAccountId,
        uploadedById: input.uploadedById,
        fileName: input.fileName.slice(0, 200),
        fileSha256,
        rowCount: parsed.rows.length + parsed.rejected.length,
        rejectedCount: parsed.rejected.length,
        status: 'PROCESSING',
      },
      select: { id: true },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // A concurrent upload of the same file won the race.
      return importStatementCsv(input);
    }
    throw e;
  }
  const res = await ingestBankTransactions(
    input.receivingAccountId,
    PgBankSource.STATEMENT_IMPORT,
    parsed.rows,
    input.uploadedById,
    { importId: imp.id },
  );
  await prisma.pgStatementImport.update({
    where: { id: imp.id },
    data: {
      insertedCount: res.insertedIds.length,
      duplicateCount: res.duplicateCount + res.conflictCount,
      status: 'COMPLETED',
    },
  });
  return {
    importId: imp.id,
    duplicateFile: false,
    insertedCount: res.insertedIds.length,
    duplicateCount: res.duplicateCount,
    conflictCount: res.conflictCount,
    rejected: parsed.rejected,
  };
}

/** Operator-entered bank movement. Starts PENDING_APPROVAL; see approveManualBankTransaction. */
export async function enterManualBankTransaction(input: {
  receivingAccountId: string;
  direction: PgTxnDirection;
  amountPaise: number;
  bankReference: string;
  valueAt: Date;
  narration?: string;
  enteredById: string;
}): Promise<{ id: string; duplicate: boolean }> {
  const bankReference = normalizeBankReference(input.bankReference);
  const narrationRedacted = input.narration ? redactNarration(input.narration) : null;
  const row: NormalizedBankTxn = {
    direction: input.direction,
    amountPaise: input.amountPaise,
    currency: 'INR',
    bankReference,
    valueAt: input.valueAt,
    narrationRedacted,
    counterpartyMasked: null,
    sourceRowHash: createHash('sha256')
      .update(JSON.stringify(['MANUAL', input.direction, input.amountPaise, bankReference, input.valueAt.toISOString()]))
      .digest('hex'),
  };
  const res = await ingestBankTransactions(input.receivingAccountId, PgBankSource.MANUAL, [row], input.enteredById);
  const found = await prisma.pgBankTransaction.findUniqueOrThrow({
    where: {
      receivingAccountId_direction_bankReference: {
        receivingAccountId: input.receivingAccountId,
        direction: input.direction,
        bankReference,
      },
    },
    select: { id: true },
  });
  return { id: found.id, duplicate: res.insertedIds.length === 0 };
}

/** Second-person approval of a MANUAL entry. The approver must differ from the person who entered it. */
export async function approveManualBankTransaction(
  bankTransactionId: string,
  approverId: string,
): Promise<{ id: string; status: PgBankTxnStatus }> {
  if (!approverId?.trim()) throw new Error('approveManualBankTransaction: approverId is required');
  const out = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PgBankTransaction" WHERE id = ${bankTransactionId} FOR UPDATE`;
    const t = await tx.pgBankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: { receivingAccount: { select: { restaurantId: true } } },
    });
    if (!t) throw new Error(`approveManualBankTransaction: ${bankTransactionId} not found`);
    if (t.source !== PgBankSource.MANUAL) throw new Error('approveManualBankTransaction: not a MANUAL entry');
    if (t.status !== PgBankTxnStatus.PENDING_APPROVAL) return { id: t.id, status: t.status, changed: false };
    if (!t.enteredById || t.enteredById === approverId) {
      throw new Error('approveManualBankTransaction: approver must be a different user than the one who entered it');
    }
    const u = await tx.pgBankTransaction.update({
      where: { id: t.id },
      data: { status: PgBankTxnStatus.UNMATCHED, approvedById: approverId },
    });
    await appendFinancialEvent(tx, {
      kind: 'BANK_TXN_APPROVED',
      restaurantId: t.receivingAccount.restaurantId,
      bankTransactionId: t.id,
      amountPaise: t.amountPaise,
      actorId: approverId,
      dedupeKey: `BANK_TXN_APPROVED:${t.id}`,
      data: { enteredById: t.enteredById },
    });
    return { id: u.id, status: u.status, changed: true };
  });
  if (out.changed) await tryAllocateBankTxn(out.id);
  return { id: out.id, status: out.status };
}
