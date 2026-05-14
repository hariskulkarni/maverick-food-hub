/**
 * OTP issuance and verification — with abuse protection.
 *
 * Limits (India SMS-cost defensive defaults):
 *   - OTP length 6, expiry 5 min
 *   - Resend cooldown: 45s between consecutive sends to the same phone
 *   - Per-phone: max 3 OTPs/hour, max 8 OTPs/day
 *   - Per-IP:    max 20 OTPs/hour
 *   - Per-OTP:   max 5 failed verify attempts → invalidate
 *   - Lockout:   30 minutes after repeated failures
 *
 * Counters live in OtpAttempt; one row per phone+purpose, updated on each call.
 */

import argon2 from 'argon2';
import { prisma } from './db';
import { notify } from './notifications';
import { log } from './log';

const OTP_TTL_MS         = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_OTP_PER_HOUR_PHONE = 3;
const MAX_OTP_PER_DAY_PHONE  = 8;
const MAX_OTP_PER_HOUR_IP    = 20;
const MAX_FAILED_VERIFY      = 5;
const LOCKOUT_MS             = 30 * 60 * 1000;
const SMS_DAILY_BUDGET       = Number(process.env.SMS_DAILY_BUDGET ?? '500'); // total SMS the platform will send today

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Callers historically pass lowercase strings ('login', 'phone_verify', etc.).
 * Map them onto the OtpPurpose enum we now use on OtpAttempt. OtpToken still
 * stores a free-form purpose string for back-compat, so we use the lowercase
 * key there and the enum key for OtpAttempt.
 */
function normalizePurposeEnum(raw: string | undefined): 'LOGIN' | 'PHONE_VERIFY' | 'RESET_PASSWORD' {
  const k = (raw ?? 'login').toUpperCase();
  if (k === 'PHONE_VERIFY') return 'PHONE_VERIFY';
  if (k === 'RESET_PASSWORD') return 'RESET_PASSWORD';
  return 'LOGIN';
}

export class OtpRateLimitedError extends Error {
  constructor(public retryAfterSeconds: number, message: string) { super(message); }
}

/**
 * Request an OTP. Throws `OtpRateLimitedError` if any of the limits are tripped.
 * `ipAddress` is required in production paths so the per-IP throttle works.
 */
export async function sendOtp(args: { phone: string; purpose?: string; ipAddress?: string }): Promise<{ ok: true; devCode?: string }> {
  const purpose = (args.purpose ?? 'login');         // free-form string for OtpToken (back-compat)
  const purposeEnum = normalizePurposeEnum(purpose);  // enum value for OtpAttempt
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // ── Per-phone tracker (one row per phone/purpose)
  const trackerId = `${args.phone}:${purposeEnum}`;
  const tracker = await prisma.otpAttempt.upsert({
    where: { id: trackerId },
    update: {},
    create: {
      id: trackerId,
      phone: args.phone,
      purpose: purposeEnum as any,
      ipAddress: args.ipAddress
    }
  });

  // Hard lockout?
  if (tracker.lockedUntil && tracker.lockedUntil > now) {
    const wait = Math.ceil((+tracker.lockedUntil - +now) / 1000);
    throw new OtpRateLimitedError(wait, `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`);
  }

  // Resend cooldown — compare with the latest OtpToken creation
  const latest = await prisma.otpToken.findFirst({
    where: { phone: args.phone, purpose },
    orderBy: { createdAt: 'desc' }
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000);
    throw new OtpRateLimitedError(wait, `Please wait ${wait}s before requesting another code.`);
  }

  // Per-phone window limits
  const sentInLastHour = await prisma.otpToken.count({ where: { phone: args.phone, purpose, createdAt: { gte: hourAgo } } });
  if (sentInLastHour >= MAX_OTP_PER_HOUR_PHONE) {
    throw new OtpRateLimitedError(60 * 60, 'Too many code requests this hour. Try again later.');
  }
  const sentInLastDay = await prisma.otpToken.count({ where: { phone: args.phone, purpose, createdAt: { gte: dayAgo } } });
  if (sentInLastDay >= MAX_OTP_PER_DAY_PHONE) {
    throw new OtpRateLimitedError(24 * 60 * 60, 'Daily code limit reached. Try tomorrow.');
  }

  // Per-IP window limit
  if (args.ipAddress) {
    const sentByIp = await prisma.otpAttempt.aggregate({
      where: { ipAddress: args.ipAddress, createdAt: { gte: hourAgo } },
      _sum: { sentCount: true }
    });
    if ((sentByIp._sum.sentCount ?? 0) >= MAX_OTP_PER_HOUR_IP) {
      throw new OtpRateLimitedError(60 * 60, 'Too many requests from this network. Try again later.');
    }
  }

  // Platform-wide SMS daily budget — flat ceiling so a bug can't drain SMS credit
  const sentTodayAll = await prisma.otpToken.count({ where: { createdAt: { gte: dayAgo } } });
  if (sentTodayAll >= SMS_DAILY_BUDGET) {
    log.error({ sentTodayAll, SMS_DAILY_BUDGET }, 'SMS daily budget reached — refusing further OTPs');
    throw new OtpRateLimitedError(60 * 60, 'Verification temporarily unavailable. Please try again later.');
  }

  // ── Issue
  const code = genCode();
  const codeHash = await argon2.hash(code);

  // Invalidate prior outstanding OTPs
  await prisma.otpToken.updateMany({
    where: { phone: args.phone, purpose, consumedAt: null },
    data: { consumedAt: now }
  });

  await prisma.$transaction([
    prisma.otpToken.create({
      data: {
        phone: args.phone,
        purpose,
        codeHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS)
      }
    }),
    prisma.otpAttempt.update({
      where: { id: tracker.id },
      data: {
        sentCount: { increment: 1 },
        ipAddress: args.ipAddress ?? tracker.ipAddress,
        attempts: 0
      }
    })
  ]);

  await notify.sms({
    to: args.phone,
    body: `Your verification code is ${code}. It expires in 5 minutes.`,
    template: 'otp.login'
  });

  // In non-prod, OR when OTP_DEBUG_LOG=true is set (demo / pre-SMS-provider
  // deployments), surface the code: log it server-side AND return it in the
  // response so it can be read without an SMS gateway. Set the flag back to
  // false / remove it the moment a real SMS provider (MSG91 etc.) is wired up.
  if (process.env.NODE_ENV !== 'production' || process.env.OTP_DEBUG_LOG === 'true') {
    log.info({ phone: args.phone, purpose, code }, 'OTP issued (debug-log)');
    return { ok: true, devCode: code };
  }
  return { ok: true };
}

export async function verifyOtp(args: { phone: string; code: string; purpose?: string }): Promise<boolean> {
  const purpose = (args.purpose ?? 'login');
  const purposeEnum = normalizePurposeEnum(purpose);
  const trackerId = `${args.phone}:${purposeEnum}`;
  const tracker = await prisma.otpAttempt.findUnique({ where: { id: trackerId } });

  if (tracker?.lockedUntil && tracker.lockedUntil > new Date()) return false;

  const token = await prisma.otpToken.findFirst({
    where: { phone: args.phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!token) return false;

  if (token.attempts >= MAX_FAILED_VERIFY) {
    await prisma.otpToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    if (tracker) {
      await prisma.otpAttempt.update({
        where: { id: trackerId },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
      });
    }
    return false;
  }

  const ok = await argon2.verify(token.codeHash, args.code);
  await prisma.otpToken.update({
    where: { id: token.id },
    data: ok ? { consumedAt: new Date() } : { attempts: { increment: 1 } }
  });

  if (tracker) {
    if (ok) {
      // Reset failure counter on success
      await prisma.otpAttempt.update({ where: { id: trackerId }, data: { attempts: 0, lockedUntil: null } });
    } else {
      const failed = (tracker.attempts ?? 0) + 1;
      const update: any = { attempts: failed };
      if (failed >= MAX_FAILED_VERIFY) update.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      await prisma.otpAttempt.update({ where: { id: trackerId }, data: update });
    }
  }
  return ok;
}
