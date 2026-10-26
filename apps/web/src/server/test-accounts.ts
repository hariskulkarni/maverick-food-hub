/**
 * Pre-launch test customer accounts.
 *
 * A User with `isTestAccount = true` (CUSTOMER, not deleted, not suspended) gets
 * its phone-login OTP shown on the login screen instead of an SMS — so the team
 * can test the live site with a dummy number before launch. Deleting the account
 * (deleteTestAccount) clears the flag and soft-deletes the user, so the on-screen
 * code stops immediately and the number can no longer sign in.
 *
 * Accounts are managed only from the server shell (scripts/test-account.ts);
 * there is deliberately no web UI to flag an account.
 */
import { Role } from '@prisma/client';
import { prisma } from './db';
import { normalizePhone } from './msg91-widget';

/** The active test account for this exact phone string, if any. */
export async function findActiveTestAccount(phone: string): Promise<{ id: string } | null> {
  if (!phone) return null;
  return prisma.user.findFirst({
    where: { phone, isTestAccount: true, deletedAt: null, suspendedAt: null, role: Role.CUSTOMER },
    select: { id: true },
  });
}

export type TestAccountResult = { ok: true; message: string; phone: string } | { ok: false; message: string };

/** 10-digit Indian mobile or +91 form → "+91XXXXXXXXXX" (the format customers type at login). */
export function testAccountPhone(raw: string): string | null {
  const p = normalizePhone(raw);
  return p && /^\+91[6-9]\d{9}$/.test(p) ? p : null;
}

export async function createTestAccount(rawPhone: string, name = 'Flavrly Test Customer'): Promise<TestAccountResult> {
  const phone = testAccountPhone(rawPhone);
  if (!phone) return { ok: false, message: 'Give a 10-digit Indian mobile number (e.g. 9XXXXXXXXX or +919XXXXXXXXX).' };
  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing && existing.role !== Role.CUSTOMER) {
    return { ok: false, message: `Refused: ${phone} belongs to a ${existing.role} account, not a customer.` };
  }
  if (existing?.deletedAt) {
    return { ok: false, message: `Refused: ${phone} belongs to a deleted account. Use a different number.` };
  }
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { isTestAccount: true } });
    return { ok: true, phone, message: `Existing customer ${phone} is now a test account.` };
  }
  await prisma.user.create({ data: { phone, name, role: Role.CUSTOMER, isTestAccount: true } });
  return { ok: true, phone, message: `Created test customer ${phone} ("${name}").` };
}

export async function listTestAccounts() {
  return prisma.user.findMany({
    where: { isTestAccount: true },
    select: { id: true, phone: true, name: true, createdAt: true, deletedAt: true, suspendedAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Turn the test account off for good: clear the flag, soft-delete, sign it out everywhere. */
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
  });
  return { ok: true, phone, message: `Deleted test account ${phone}: on-screen codes stopped and its sessions were revoked.` };
}
