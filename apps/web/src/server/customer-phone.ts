/**
 * Mandatory, OTP-verified phone for CUSTOMER accounts.
 *
 * Why: the phone is used for deliveries (rider calls, order SMS) and other
 * important workflows, so a customer who signed in with Google must add and
 * verify a mobile number before ordering, checking out or booking a table.
 *
 *   - `phoneGateResponse` — the server-side gate used by the order and
 *     reservation APIs (session.user.phoneVerified is re-read from the DB on
 *     every auth() call in the jwt callback, so it is never stale here).
 *   - `verifyCustomerPhone` — checks the OTP (purpose `phone_verify`, same
 *     limits/lockouts as login) and attaches the number to the account.
 *   - Number already on another account: OTP proves the caller owns it. When
 *     that other account is a plain phone-only CUSTOMER and the caller is a
 *     fresh Google account (no verified phone yet), we offer to LINK the Google
 *     identity to the existing account (one account, not a duplicate). The
 *     caller must confirm; we never overwrite an existing email or move a
 *     number off an account silently. Otherwise the caller gets a clear
 *     message and must use a different number.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Role, type Prisma } from '@prisma/client';
import { prisma } from './db';
import { audit } from './audit';
import { verifyOtp } from './otp';
import { welcomeUrl } from '@/lib/onboarding';

export const PHONE_VERIFY_PURPOSE = 'phone_verify';
export const PHONE_REQUIRED_CODE = 'PHONE_VERIFICATION_REQUIRED';

/** "+91" + a 10-digit Indian mobile (6–9 first digit) — how customer phones are stored. */
export function isIndianMobileE164(phone: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(phone);
}

type GateSession = { user?: { role?: string | null; phoneVerified?: boolean | null } | null } | null;

/**
 * 403 for a CUSTOMER without a verified phone, else null. Other roles are not
 * customers and are unaffected. `next` is where the phone step returns to.
 */
export function phoneGateResponse(session: GateSession, next: string): Response | null {
  if (!session?.user || session.user.role !== Role.CUSTOMER) return null;
  if (session.user.phoneVerified === true) return null;
  return Response.json(
    {
      error: 'Please add and verify your mobile number first — we use it for delivery updates.',
      code: PHONE_REQUIRED_CODE,
      redirectTo: welcomeUrl(next),
    },
    { status: 403 },
  );
}

// ── Link ticket (Google identity → existing phone account) ───────────────────

const LINK_TTL_MS = 10 * 60 * 1000;

function ticketSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is required');
  return s;
}

type LinkClaims = { from: string; to: string; phone: string; exp: number };

export function mintLinkTicket(c: Omit<LinkClaims, 'exp'>, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...c, exp: now + LINK_TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', ticketSecret()).update(`phone-link.${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function readLinkTicket(ticket: string, now = Date.now()): LinkClaims | null {
  const [body, sig] = String(ticket ?? '').split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', ticketSecret()).update(`phone-link.${body}`).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkClaims;
    if (typeof c.exp !== 'number' || c.exp < now) return null;
    if (!c.from || !c.to || !c.phone) return null;
    return c;
  } catch {
    return null;
  }
}

/** "Priya Iyer" → "P***a I." — enough to recognise your own account, not to identify a stranger. */
export function maskName(name: string | null | undefined): string | null {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  const head = first.length <= 2 ? `${first[0]}*` : `${first[0]}${'*'.repeat(Math.min(3, first.length - 2))}${first[first.length - 1]}`;
  return rest.length ? `${head} ${rest[0][0]}.` : head;
}

// ── Verify + attach ──────────────────────────────────────────────────────────

export type VerifyPhoneResult =
  | { status: 'verified'; phone: string }
  | { status: 'invalid_phone' | 'invalid_code' | 'forbidden'; message: string }
  | { status: 'conflict'; message: string; canSignInWithPhone: boolean }
  | { status: 'link_available'; ticket: string; maskedName: string | null; message: string };

const CONFLICT_STAFF = "This number can't be used for a customer account. Please use a different mobile number.";
const CONFLICT_OTHER =
  'This number already belongs to another Flavrly account. Sign in with this mobile number instead, or use a different number here.';
const CONFLICT_CHANGE = 'This number is already linked to another Flavrly account. Please use a different number.';

export async function verifyCustomerPhone(args: { userId: string; phone: string; code: string }): Promise<VerifyPhoneResult> {
  const phone = String(args.phone ?? '').trim();
  if (!isIndianMobileE164(phone)) return { status: 'invalid_phone', message: 'Enter a valid 10-digit Indian mobile number.' };
  const me = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { id: true, role: true, phone: true, phoneVerifiedAt: true, email: true, deletedAt: true, suspendedAt: true },
  });
  if (!me || me.role !== Role.CUSTOMER || me.deletedAt || me.suspendedAt) {
    return { status: 'forbidden', message: 'Only customer accounts can add a phone here.' };
  }
  const ok = await verifyOtp({ phone, code: String(args.code ?? '').trim(), purpose: PHONE_VERIFY_PURPOSE });
  if (!ok) return { status: 'invalid_code', message: 'That code is wrong or has expired. Check it, or tap Resend code.' };

  const owner = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, role: true, name: true, email: true, deletedAt: true, suspendedAt: true },
  });

  if (!owner || owner.id === me.id) {
    try {
      await prisma.user.update({ where: { id: me.id }, data: { phone, phoneVerifiedAt: new Date() } });
    } catch (e) {
      // Lost a race: someone else took the number between verify and save.
      if ((e as { code?: string }).code === 'P2002') return { status: 'conflict', message: CONFLICT_CHANGE, canSignInWithPhone: false };
      throw e;
    }
    await audit('customer.phone.verified', {
      actorId: me.id, actorRole: me.role, entityType: 'User', entityId: me.id,
      after: { changed: me.phone !== phone, hadVerifiedPhone: !!me.phoneVerifiedAt },
    }).catch(() => {});
    return { status: 'verified', phone };
  }

  // The number is on someone else's account. OTP proved the caller owns it.
  const ownerIsCustomer = owner.role === Role.CUSTOMER && !owner.deletedAt && !owner.suspendedAt;
  if (!ownerIsCustomer) {
    await audit('customer.phone.conflict', { actorId: me.id, entityType: 'User', entityId: me.id, after: { reason: 'owner_not_customer' } }).catch(() => {});
    return { status: 'conflict', message: CONFLICT_STAFF, canSignInWithPhone: false };
  }
  // Already-verified accounts only ever change to a free number (no merging).
  if (me.phoneVerifiedAt) return { status: 'conflict', message: CONFLICT_CHANGE, canSignInWithPhone: false };
  // Linkable only when it cannot overwrite anything: the existing account has
  // no email yet and the caller is a Google (email) account.
  if (owner.email || !me.email) {
    await audit('customer.phone.conflict', { actorId: me.id, entityType: 'User', entityId: me.id, after: { reason: 'owner_has_email' } }).catch(() => {});
    return { status: 'conflict', message: CONFLICT_OTHER, canSignInWithPhone: true };
  }
  return {
    status: 'link_available',
    ticket: mintLinkTicket({ from: me.id, to: owner.id, phone }),
    maskedName: maskName(owner.name),
    message: 'Good news — you already have a Flavrly account with this number.',
  };
}

/**
 * Consume a link ticket (called by the `phone-link` sign-in provider): move the
 * Google email onto the existing phone account and retire the empty Google
 * account. Returns the account to sign in as, or null when the ticket is
 * invalid/expired/already used or anything changed since it was minted.
 */
export async function linkGoogleToPhoneAccount(ticket: string): Promise<{ id: string; name: string | null; email: string | null } | null> {
  const c = readLinkTicket(ticket);
  if (!c) return null;
  const linked = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const from = await tx.user.findUnique({ where: { id: c.from } });
    const to = await tx.user.findUnique({ where: { id: c.to } });
    if (!from || !to) return null;
    if (from.role !== Role.CUSTOMER || from.deletedAt || from.suspendedAt || !from.email || from.phoneVerifiedAt) return null;
    if (to.role !== Role.CUSTOMER || to.deletedAt || to.suspendedAt || to.email || to.phone !== c.phone) return null;
    const email = from.email;
    // Release the email first (unique), then retire the empty Google account.
    await tx.user.update({ where: { id: from.id }, data: { email: null, deletedAt: new Date(), currentSessionId: null } });
    return tx.user.update({
      where: { id: to.id },
      data: {
        email,
        phoneVerifiedAt: to.phoneVerifiedAt ?? new Date(),
        name: to.name ?? from.name,
        avatarUrl: to.avatarUrl ?? from.avatarUrl,
      },
      select: { id: true, name: true, email: true },
    });
  });
  if (linked) {
    await audit('customer.google.linked', {
      actorId: linked.id, actorRole: Role.CUSTOMER, entityType: 'User', entityId: linked.id,
      after: { mergedFrom: c.from },
    }).catch(() => {});
  }
  return linked;
}
