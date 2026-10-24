/**
 * Flavrly PG receiving-account onboarding (contract D7, master prompt §6).
 *
 * A PgReceivingAccount binds one restaurant to one gateway merchant id, one receiving VPA and
 * one bank account. It starts PENDING_VERIFICATION and only a SUPER_ADMIN who did NOT create it
 * can mark it VERIFIED. The database backs this with two partial unique indexes
 * (one VERIFIED account per gatewayMerchantId, one VERIFIED account per restaurant).
 *
 * The raw bank account number is never stored: only `accountFingerprint`
 * (sha256 of normalized IFSC + account number) and the last 4 digits.
 *
 * Restaurant admins cannot change the receiving VPA directly (threat model T-04). They file a
 * VPA change request (`requestVpaChange`), which has no effect on payments until a super admin
 * creates and verifies a receiving account with that VPA.
 *
 * Every state change writes an AuditLog row with before/after snapshots (no raw account number).
 */
import { createHash } from 'node:crypto';
import { PgReceivingAccountStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { getConfig, saveConfig } from '../integrations';

export const VPA_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

export type ReceivingAccountErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'SAME_PERSON'
  | 'INVALID_STATE'
  | 'VPA_ALREADY_REGISTERED'
  | 'GATEWAY_MERCHANT_ALREADY_BOUND'
  | 'RESTAURANT_ALREADY_VERIFIED';

export class ReceivingAccountError extends Error {
  constructor(
    public readonly code: ReceivingAccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReceivingAccountError';
  }
  get httpStatus(): number {
    switch (this.code) {
      case 'INVALID_INPUT':
        return 400;
      case 'NOT_FOUND':
        return 404;
      case 'FORBIDDEN':
        return 403;
      default:
        return 409;
    }
  }
}

export interface Actor {
  id: string;
  role: string;
}

export function normalizeVpa(raw: string): string {
  const v = String(raw ?? '').trim();
  if (!VPA_RE.test(v)) throw new ReceivingAccountError('INVALID_INPUT', 'Enter a valid UPI ID like name@bank');
  return v.toLowerCase();
}

export function normalizeIfsc(raw: string): string {
  const v = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!IFSC_RE.test(v)) throw new ReceivingAccountError('INVALID_INPUT', 'IFSC must look like ABCD0123456');
  return v;
}

export function normalizeAccountNumber(raw: string): string {
  const v = String(raw ?? '').replace(/[\s-]+/g, '');
  if (!ACCOUNT_RE.test(v)) throw new ReceivingAccountError('INVALID_INPUT', 'Bank account number must be 9 to 18 digits');
  return v;
}

/** sha256 of the normalized bank identity. The only persisted form of the account number. */
export function accountFingerprint(ifsc: string, accountNumber: string): string {
  return createHash('sha256').update(`${normalizeIfsc(ifsc)}:${normalizeAccountNumber(accountNumber)}`, 'utf8').digest('hex');
}

function requireSuperAdminActor(actor: Actor) {
  if (!actor?.id?.trim() || actor.role !== Role.SUPER_ADMIN) {
    throw new ReceivingAccountError('FORBIDDEN', 'Only a platform super admin can do that.');
  }
}

function requireText(v: unknown, label: string, max = 500): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new ReceivingAccountError('INVALID_INPUT', `${label} is required`);
  if (s.length > max) throw new ReceivingAccountError('INVALID_INPUT', `${label} is too long (max ${max} characters)`);
  return s;
}

/** Snapshot used for audit before/after. Contains no raw account number. */
function snap(a: {
  status: PgReceivingAccountStatus;
  gatewayMerchantId: string;
  vpaNormalized: string;
  accountLast4: string | null;
  ifsc: string | null;
  disabledForNewAt: Date | null;
  verifiedById: string | null;
  verificationMethod: string | null;
}) {
  return {
    status: a.status,
    gatewayMerchantId: a.gatewayMerchantId,
    vpa: a.vpaNormalized,
    ifsc: a.ifsc,
    accountLast4: a.accountLast4,
    disabledForNewAt: a.disabledForNewAt?.toISOString() ?? null,
    verifiedById: a.verifiedById,
    verificationMethod: a.verificationMethod,
  };
}

export interface CreateReceivingAccountInput {
  restaurantId: string;
  gatewayMerchantId: string;
  vpa: string;
  legalEntityName: string;
  ifsc: string;
  accountNumber: string;
}

export async function createReceivingAccount(input: CreateReceivingAccountInput, actor: Actor) {
  requireSuperAdminActor(actor);
  const restaurantId = requireText(input.restaurantId, 'Restaurant', 64);
  const gatewayMerchantId = requireText(input.gatewayMerchantId, 'Gateway merchant id', 128);
  const legalEntityName = requireText(input.legalEntityName, 'Legal entity name', 200);
  const vpaNormalized = normalizeVpa(input.vpa);
  const ifsc = normalizeIfsc(input.ifsc);
  const accountNumber = normalizeAccountNumber(input.accountNumber);

  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
  if (!restaurant) throw new ReceivingAccountError('NOT_FOUND', 'No such restaurant');

  try {
    const row = await prisma.pgReceivingAccount.create({
      data: {
        restaurantId,
        gatewayMerchantId,
        vpa: String(input.vpa).trim(),
        vpaNormalized,
        accountFingerprint: accountFingerprint(ifsc, accountNumber),
        accountLast4: accountNumber.slice(-4),
        ifsc,
        legalEntityName,
        status: PgReceivingAccountStatus.PENDING_VERIFICATION,
        createdById: actor.id,
      },
    });
    await audit('pg.receiving_account.create', {
      actorId: actor.id,
      actorRole: actor.role,
      restaurantId,
      entityType: 'PgReceivingAccount',
      entityId: row.id,
      before: null,
      after: snap(row),
    });
    return row;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ReceivingAccountError('VPA_ALREADY_REGISTERED', 'This UPI ID is already registered for this restaurant.');
    }
    throw e;
  }
}

async function loadOrThrow(id: string) {
  const a = await prisma.pgReceivingAccount.findUnique({ where: { id } });
  if (!a) throw new ReceivingAccountError('NOT_FOUND', 'No such receiving account');
  return a;
}

/** Map a partial-unique-index violation on VERIFY to a clear error. */
async function explainVerifyConflict(a: { id: string; restaurantId: string; gatewayMerchantId: string }): Promise<ReceivingAccountError> {
  const byMerchant = await prisma.pgReceivingAccount.findFirst({
    where: { gatewayMerchantId: a.gatewayMerchantId, status: PgReceivingAccountStatus.VERIFIED, id: { not: a.id } },
    select: { id: true },
  });
  if (byMerchant) {
    return new ReceivingAccountError(
      'GATEWAY_MERCHANT_ALREADY_BOUND',
      'This gateway merchant id is already bound to another VERIFIED receiving account. Suspend or revoke that account first.',
    );
  }
  const byRestaurant = await prisma.pgReceivingAccount.findFirst({
    where: { restaurantId: a.restaurantId, status: PgReceivingAccountStatus.VERIFIED, id: { not: a.id } },
    select: { id: true },
  });
  if (byRestaurant) {
    return new ReceivingAccountError(
      'RESTAURANT_ALREADY_VERIFIED',
      'This restaurant already has a VERIFIED receiving account. Suspend or revoke it before verifying another.',
    );
  }
  return new ReceivingAccountError('INVALID_STATE', 'The account could not be verified because of a conflicting binding.');
}

/**
 * SUPER_ADMIN verification. The verifier must differ from the creator. PENDING_VERIFICATION or
 * SUSPENDED -> VERIFIED (clears disabledForNewAt). Also makes the verified VPA the effective
 * receiving VPA for the legacy config resolver and clears a matching pending VPA request.
 */
export async function verifyReceivingAccount(
  id: string,
  input: { method: string; note: string },
  actor: Actor,
) {
  requireSuperAdminActor(actor);
  const method = requireText(input.method, 'Verification method', 100);
  const note = requireText(input.note, 'Verification note', 1000);
  const a = await loadOrThrow(id);
  if (a.createdById && a.createdById === actor.id) {
    throw new ReceivingAccountError('SAME_PERSON', 'A different super admin must verify an account you created.');
  }
  if (a.status !== PgReceivingAccountStatus.PENDING_VERIFICATION && a.status !== PgReceivingAccountStatus.SUSPENDED) {
    throw new ReceivingAccountError('INVALID_STATE', `Cannot verify an account in status ${a.status}.`);
  }
  const pre = await explainVerifyConflict(a);
  if (pre.code !== 'INVALID_STATE') throw pre;

  let updated;
  try {
    const { count } = await prisma.pgReceivingAccount.updateMany({
      where: { id, status: a.status },
      data: {
        status: PgReceivingAccountStatus.VERIFIED,
        verificationMethod: method,
        verificationNote: note,
        verifiedAt: new Date(),
        verifiedById: actor.id,
        disabledForNewAt: null,
      },
    });
    if (count === 0) throw new ReceivingAccountError('INVALID_STATE', 'The account changed concurrently; reload and retry.');
    updated = await loadOrThrow(id);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw await explainVerifyConflict(a);
    throw e;
  }
  await audit('pg.receiving_account.verify', {
    actorId: actor.id,
    actorRole: actor.role,
    restaurantId: a.restaurantId,
    entityType: 'PgReceivingAccount',
    entityId: id,
    before: snap(a),
    after: { ...snap(updated), verificationNote: note },
  });
  await syncLegacyReceivingVpa(a.restaurantId, updated.vpa, updated.vpaNormalized, actor);
  return updated;
}

/**
 * The pre-D7 resolver (`payments/youpi.ts` resolveYoupiConfig) reads `receivingVpa` from the
 * restaurant's YOUPI IntegrationCredential. Only super-admin verification writes it now.
 */
async function syncLegacyReceivingVpa(restaurantId: string, vpa: string, vpaNormalized: string, actor: Actor) {
  const cfg = (await getConfig(restaurantId, 'YOUPI')) ?? {};
  const next: Record<string, string> = { ...cfg, receivingVpa: vpa };
  if (cfg.pendingReceivingVpa && cfg.pendingReceivingVpa.toLowerCase() === vpaNormalized) {
    delete next.pendingReceivingVpa;
    delete next.pendingReceivingVpaRequestedAt;
    delete next.pendingReceivingVpaRequestedById;
  }
  await saveConfig(restaurantId, 'YOUPI', next, { status: 'CONNECTED', userId: actor.id });
  await audit('youpi.vpa.apply_verified', {
    actorId: actor.id,
    actorRole: actor.role,
    restaurantId,
    entityType: 'IntegrationCredential',
    before: { receivingVpa: cfg.receivingVpa ?? null },
    after: { receivingVpa: vpa },
  });
}

export type AccountAction = 'SUSPEND' | 'DISABLE_NEW' | 'ENABLE_NEW' | 'REVOKE';

const ACTION_FROM: Record<AccountAction, PgReceivingAccountStatus[]> = {
  SUSPEND: [PgReceivingAccountStatus.VERIFIED, PgReceivingAccountStatus.PENDING_VERIFICATION],
  DISABLE_NEW: [PgReceivingAccountStatus.VERIFIED],
  ENABLE_NEW: [PgReceivingAccountStatus.VERIFIED],
  REVOKE: [
    PgReceivingAccountStatus.PENDING_VERIFICATION,
    PgReceivingAccountStatus.VERIFIED,
    PgReceivingAccountStatus.SUSPENDED,
  ],
};

/**
 * Suspend / disable-for-new / re-enable-for-new / revoke. None of these strand in-flight
 * payments: reconciliation keeps working on every status (D7); they only block NEW sessions.
 */
export async function changeReceivingAccountStatus(id: string, action: AccountAction, reasonRaw: string, actor: Actor) {
  requireSuperAdminActor(actor);
  if (!(action in ACTION_FROM)) throw new ReceivingAccountError('INVALID_INPUT', 'Unknown action');
  const reason = requireText(reasonRaw, 'Reason', 1000);
  const a = await loadOrThrow(id);
  if (!ACTION_FROM[action].includes(a.status)) {
    throw new ReceivingAccountError('INVALID_STATE', `Cannot ${action.toLowerCase().replace('_', ' ')} an account in status ${a.status}.`);
  }
  const now = new Date();
  const data: Prisma.PgReceivingAccountUpdateManyMutationInput =
    action === 'SUSPEND'
      ? { status: PgReceivingAccountStatus.SUSPENDED, disabledForNewAt: a.disabledForNewAt ?? now }
      : action === 'REVOKE'
        ? { status: PgReceivingAccountStatus.REVOKED, disabledForNewAt: a.disabledForNewAt ?? now }
        : action === 'DISABLE_NEW'
          ? { disabledForNewAt: a.disabledForNewAt ?? now }
          : { disabledForNewAt: null };
  const { count } = await prisma.pgReceivingAccount.updateMany({ where: { id, status: a.status }, data });
  if (count === 0) throw new ReceivingAccountError('INVALID_STATE', 'The account changed concurrently; reload and retry.');
  const updated = await loadOrThrow(id);
  await audit(`pg.receiving_account.${action.toLowerCase()}`, {
    actorId: actor.id,
    actorRole: actor.role,
    restaurantId: a.restaurantId,
    entityType: 'PgReceivingAccount',
    entityId: id,
    before: snap(a),
    after: { ...snap(updated), reason },
  });
  return updated;
}

// ───────────────────────────── VPA change requests (T-04) ─────────────────────────────

/**
 * A restaurant ADMIN asks for a new receiving VPA. Stored as a pending request on the
 * restaurant's YOUPI credential; `receivingVpa` (the effective one) is NOT changed.
 * The caller must already have checked that the actor is an ADMIN of this restaurant.
 */
export async function requestVpaChange(restaurantId: string, vpaRaw: string, actor: Actor) {
  const vpa = String(vpaRaw ?? '').trim();
  normalizeVpa(vpa);
  const cfg = (await getConfig(restaurantId, 'YOUPI')) ?? {};
  const before = { receivingVpa: cfg.receivingVpa ?? null, pendingReceivingVpa: cfg.pendingReceivingVpa ?? null };
  const requestedAt = new Date().toISOString();
  await saveConfig(
    restaurantId,
    'YOUPI',
    { ...cfg, pendingReceivingVpa: vpa, pendingReceivingVpaRequestedAt: requestedAt, pendingReceivingVpaRequestedById: actor.id },
    { status: 'CONNECTED', userId: actor.id },
  );
  await audit('youpi.vpa.change_requested', {
    actorId: actor.id,
    actorRole: actor.role,
    restaurantId,
    entityType: 'IntegrationCredential',
    before,
    after: { receivingVpa: cfg.receivingVpa ?? null, pendingReceivingVpa: vpa },
  });
  return { pendingReceivingVpa: vpa, requestedAt, effectiveReceivingVpa: cfg.receivingVpa ?? null };
}

export interface PendingVpaRequest {
  restaurantId: string;
  restaurantName: string;
  pendingReceivingVpa: string;
  requestedAt: string | null;
  currentReceivingVpa: string | null;
}

/** Super-admin queue of pending VPA change requests (restaurants with an APPROVED feature request). */
export async function listPendingVpaRequests(): Promise<PendingVpaRequest[]> {
  const approved = await prisma.youpiFeatureRequest.findMany({
    where: { status: 'APPROVED' },
    select: { restaurantId: true, restaurant: { select: { name: true } } },
    take: 500,
  });
  const out: PendingVpaRequest[] = [];
  for (const r of approved) {
    const cfg = await getConfig(r.restaurantId, 'YOUPI').catch(() => null);
    if (!cfg?.pendingReceivingVpa) continue;
    out.push({
      restaurantId: r.restaurantId,
      restaurantName: r.restaurant?.name ?? r.restaurantId,
      pendingReceivingVpa: cfg.pendingReceivingVpa,
      requestedAt: cfg.pendingReceivingVpaRequestedAt ?? null,
      currentReceivingVpa: cfg.receivingVpa ?? null,
    });
  }
  return out;
}
