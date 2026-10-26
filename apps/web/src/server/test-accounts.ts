/**
 * Pre-launch test accounts (CUSTOMER and RIDER).
 *
 * A User with `isTestAccount = true` (not deleted, not suspended) gets its
 * phone-login OTP shown on the login screen / in the rider app instead of an
 * SMS — so the team can test the live system with a dummy number before launch.
 * Deleting the account (deleteTestAccount) clears the flag and soft-deletes the
 * user, so the on-screen code stops immediately and the number can no longer
 * sign in.
 *
 * Test riders are isolated from real work (rider-sourcing.testIsolationAllows):
 * they only ever see/claim/get test-customer orders, real riders never get test
 * orders, test riders don't count as fleet supply, have the KYC gate waived
 * (rider-kyc-gate) and cannot request payouts.
 *
 * Managed from the server shell (scripts/test-account.ts) or by a 2FA-verified
 * SUPER_ADMIN at /platform/users/test-accounts — both call these functions.
 */
import { Role, RiderType } from '@prisma/client';
import { prisma } from './db';
import { normalizePhone } from './msg91-widget';

/**
 * The active test account for this exact phone string, if any. `roles` scopes
 * which surface may reveal the code: the customer login asks for CUSTOMER (the
 * default), the rider login asks for RIDER — a rider test number never gets an
 * on-screen code on the customer site and vice versa.
 */
export async function findActiveTestAccount(
  phone: string,
  roles: Role[] = [Role.CUSTOMER],
): Promise<{ id: string } | null> {
  if (!phone) return null;
  return prisma.user.findFirst({
    where: { phone, isTestAccount: true, deletedAt: null, suspendedAt: null, role: { in: roles } },
    select: { id: true },
  });
}

export type TestAccountRole = 'CUSTOMER' | 'RIDER';
export type TestAccountResult = { ok: true; message: string; phone: string; userId: string } | { ok: false; message: string };

const DEFAULT_NAME: Record<TestAccountRole, string> = {
  CUSTOMER: 'Flavrly Test Customer',
  RIDER: 'Flavrly Test Rider',
};

/** 10-digit Indian mobile or +91 form → "+91XXXXXXXXXX" (the format typed at login). */
export function testAccountPhone(raw: string): string | null {
  const p = normalizePhone(raw);
  return p && /^\+91[6-9]\d{9}$/.test(p) ? p : null;
}

/**
 * Create a test account. Guards (shared by the script and the super-admin UI):
 *   - the phone must be a valid Indian mobile;
 *   - a deleted account's phone is refused;
 *   - a phone that is already a test account of the OTHER role is refused;
 *   - RIDER: any phone owned by a real (non-test) user is refused — a real
 *     person's account is never turned into a test rider;
 *   - CUSTOMER: same — refused by default; only the server script can opt in
 *     with `--allow-existing-customer` to flag an existing real customer.
 */
export async function createTestAccount(
  rawPhone: string,
  name?: string,
  role: TestAccountRole = 'CUSTOMER',
  opts: { allowExistingCustomer?: boolean } = {},
): Promise<TestAccountResult> {
  const allowExistingCustomer = opts.allowExistingCustomer ?? false;
  const phone = testAccountPhone(rawPhone);
  if (!phone) return { ok: false, message: 'Give a 10-digit Indian mobile number (e.g. 9XXXXXXXXX or +919XXXXXXXXX).' };
  const label = role === 'RIDER' ? 'rider' : 'customer';
  const displayName = (name ?? '').trim() || DEFAULT_NAME[role];
  const existing = await prisma.user.findUnique({ where: { phone } });

  if (existing?.deletedAt) {
    return { ok: false, message: `Refused: ${phone} belongs to a deleted account. Use a different number.` };
  }
  if (existing?.isTestAccount) {
    if (existing.role === role) return { ok: true, phone, userId: existing.id, message: `${phone} is already a test ${label}.` };
    return { ok: false, message: `Refused: ${phone} is already a test ${existing.role.toLowerCase()} account. Use a different number for the test ${label}.` };
  }
  if (existing) {
    if (role === 'RIDER' || existing.role !== Role.CUSTOMER || !allowExistingCustomer) {
      return {
        ok: false,
        message: `Refused: ${phone} belongs to a real ${existing.role.toLowerCase()} account. Use a number nobody uses.`,
      };
    }
    await prisma.user.update({ where: { id: existing.id }, data: { isTestAccount: true } });
    return { ok: true, phone, userId: existing.id, message: `Existing customer ${phone} is now a test account.` };
  }

  if (role === 'RIDER') {
    // Same shape a super-admin approval produces (rider-applications approve):
    // RIDER user + approved FLEET profile, ready to go online.
    const user = await prisma.user.create({
      data: {
        phone,
        name: displayName,
        role: Role.RIDER,
        isTestAccount: true,
        riderProfile: { create: { approvedAt: new Date(), riderType: RiderType.FLEET, vehicleType: 'BIKE' } },
      },
      select: { id: true },
    });
    return { ok: true, phone, userId: user.id, message: `Created test rider ${phone} ("${displayName}").` };
  }
  const user = await prisma.user.create({
    data: { phone, name: displayName, role: Role.CUSTOMER, isTestAccount: true },
    select: { id: true },
  });
  return { ok: true, phone, userId: user.id, message: `Created test customer ${phone} ("${displayName}").` };
}

export async function listTestAccounts() {
  return prisma.user.findMany({
    where: { isTestAccount: true },
    select: { id: true, phone: true, name: true, role: true, createdAt: true, deletedAt: true, suspendedAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Turn the test account off for good: clear the flag, soft-delete, sign it out everywhere (riders also go offline). */
export async function deleteTestAccount(rawPhone: string): Promise<TestAccountResult> {
  const phone = testAccountPhone(rawPhone);
  if (!phone) return { ok: false, message: 'Give the 10-digit number of the test account.' };
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !user.isTestAccount) return { ok: false, message: `${phone} is not a test account.` };
  // Lazy import keeps this module (imported by otp.ts) free of the admin module graph.
  const { revokeAllSessions } = await import('./platform-user-admin');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { isTestAccount: false, deletedAt: new Date() } });
    await revokeAllSessions(tx, user.id, 'test_account_deleted');
    if (user.role === Role.RIDER) {
      await tx.riderProfile.updateMany({ where: { userId: user.id }, data: { isOnline: false } });
    }
  });
  return {
    ok: true,
    phone,
    userId: user.id,
    message: `Deleted test account ${phone}: on-screen codes stopped and its sessions were revoked.`,
  };
}
