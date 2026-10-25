/**
 * OTP issuance and verification — with abuse protection.
 *
 * Limits (India SMS-cost defensive defaults  all env-overridable):
 *   - OTP length 6, expiry 5 min
 *   - Resend cooldown: 45s between consecutive sends to the same phone
 *   - Per-phone: max 10 OTPs/hour, max 20 OTPs/day
 *   - Per-IP:    max 40 OTPs/hour
 *   - Per-OTP:   max 5 failed verify attempts → invalidate
 *   - Lockout:   30 minutes after repeated failures
 *   - Platform:  SMS_DAILY_BUDGET hard ceiling so a bug can't drain SMS credit
 *
 * Env overrides — handy for staging, load tests, demos, etc.:
 *   OTP_RATE_LIMITS_DISABLED=true → skip ALL abuse limits (only resend cooldown
 *                                    + lockout still apply). The default is
 *                                    OFF, so production stays protected.
 *   OTP_MAX_PER_HOUR_PHONE        → override the 10/hr per-phone cap
 *   OTP_MAX_PER_DAY_PHONE         → override the 20/day per-phone cap
 *   OTP_MAX_PER_HOUR_IP           → override the 40/hr per-IP cap
 *   SMS_DAILY_BUDGET              → override the 1000/day platform cap
 *
 * Demo mode (OTP_DEMO_MODE / OTP_DEBUG_LOG): rate limits are AUTOMATICALLY
 * skipped  there's no real SMS leaving the system, so 'abuse protection'
 * makes no sense and just breaks the demo experience. The resend cooldown +
 * lockout still apply (good UX guards, no SMS cost involved).
 *
 * Counters live in OtpAttempt; one row per phone+purpose, updated on each call.
 */
import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { prisma } from './db';
import { notify } from './notifications';
import { log } from './log';
import { getPlatformSecurity, setPlatformSecurity } from './2fa';
/** Parse a positive integer env var with a default. Tolerant of empty/NaN. */
function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}
const OTP_TTL_MS         = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_OTP_PER_HOUR_PHONE = envInt('OTP_MAX_PER_HOUR_PHONE', 10);
const MAX_OTP_PER_DAY_PHONE  = envInt('OTP_MAX_PER_DAY_PHONE',  20);
const MAX_OTP_PER_HOUR_IP    = envInt('OTP_MAX_PER_HOUR_IP',    40);
const MAX_FAILED_VERIFY      = 5;
const LOCKOUT_MS             = 30 * 60 * 1000;
const SMS_DAILY_BUDGET       = envInt('SMS_DAILY_BUDGET',     1000); // total SMS the platform will send today
const RATE_LIMITS_DISABLED   = process.env.OTP_RATE_LIMITS_DISABLED === 'true';
const IS_PROD = process.env.NODE_ENV === 'production';
// Is a REAL SMS provider configured? (anything other than the no-op "mock")
// F12: same setting the dispatcher reads — NOTIFIER_SMS, legacy alias SMS_PROVIDER.
const SMS_PROVIDER = (process.env.NOTIFIER_SMS || process.env.SMS_PROVIDER || 'mock').toLowerCase().trim();
const SMS_IS_REAL = SMS_PROVIDER !== '' && SMS_PROVIDER !== 'mock';
// Real WhatsApp provider configured? (Meta Cloud API or Twilio WhatsApp.)
const WHATSAPP_PROVIDER = (process.env.NOTIFIER_WHATSAPP || 'mock').toLowerCase().trim();
const WHATSAPP_IS_REAL = WHATSAPP_PROVIDER !== '' && WHATSAPP_PROVIDER !== 'mock';
// Any real delivery channel means surfacing codes would leak real users' OTPs.
const DELIVERY_IS_REAL = SMS_IS_REAL || WHATSAPP_IS_REAL;
// OTP delivery channel(s). Default 'sms' preserves prior behaviour. Options:
//   sms | whatsapp | whatsapp_then_sms | sms_then_whatsapp | both
const OTP_CHANNEL = (process.env.OTP_CHANNEL ?? 'sms').toLowerCase().trim();
// Demo mode: deliberately surface OTP codes (in the API response + server log)
// so you can run a live demo before buying an SMS gateway. Opt-in via
// OTP_DEMO_MODE=true; the legacy OTP_DEBUG_LOG=true is honoured as an alias so
// existing demo deployments keep working.
const OTP_DEMO_MODE =
  process.env.OTP_DEMO_MODE === 'true' || process.env.OTP_DEBUG_LOG === 'true';
// ── Plug-and-play safety guard ──────────────────────────────────────────────
// Surfacing codes is fine while there are no real users (mock SMS). But the
// moment a REAL provider is configured, surfacing would leak genuine users'
// OTPs  a full account-takeover vector. So we HARD-FAIL at boot on that exact
// misconfiguration: real provider + demo surfacing both on. The plug-and-play
// switch to production is therefore: set NOTIFIER_SMS=<provider> (+ creds) and
// set OTP_DEMO_MODE=false (remove OTP_DEBUG_LOG) — codes stop surfacing
// automatically; no code change needed.
if (DELIVERY_IS_REAL && OTP_DEMO_MODE) {
  const which = SMS_IS_REAL ? `NOTIFIER_SMS=${SMS_PROVIDER}` : `NOTIFIER_WHATSAPP=${WHATSAPP_PROVIDER}`;
  throw new Error(
    `OTP demo mode is enabled (OTP_DEMO_MODE/OTP_DEBUG_LOG) while a real delivery provider ` +
      `(${which}) is configured. This would leak real users' OTP codes. ` +
      `Set OTP_DEMO_MODE=false and remove OTP_DEBUG_LOG before going live.`
  );
}
// Loud, repeated reminder when demo mode is live in production (mock SMS). This
// is acceptable ONLY for a pre-launch demo with no real users.
if (IS_PROD && OTP_DEMO_MODE) {
  log.warn(
    '[otp] DEMO MODE ACTIVE  OTP codes are surfaced in API responses/logs (no real SMS gateway). ' +
      'Configure NOTIFIER_SMS + set OTP_DEMO_MODE=false before launch.'
  );
}
// Boot log: surface the active rate-limit policy ONCE so a quick `pm2 logs`
// tells you whether limits are on, off, or in demo bypass — without diving
// into source.
{
  const policy = OTP_DEMO_MODE
    ? 'DEMO BYPASS (codes surfaced, abuse limits skipped)'
    : RATE_LIMITS_DISABLED
      ? 'DISABLED (OTP_RATE_LIMITS_DISABLED=true — staging escape hatch)'
      : `phone ${MAX_OTP_PER_HOUR_PHONE}/hr ${MAX_OTP_PER_DAY_PHONE}/day · ip ${MAX_OTP_PER_HOUR_IP}/hr · platform ${SMS_DAILY_BUDGET}/day`;
  log.info(`[otp] rate-limit policy: ${policy}`);
}
function genCode(): string {
  // H22: use a CSPRNG. Math.random() (V8 xorshift128+) is predictable from a run
  // of outputs an attacker can mint for their own number. randomInt's upper bound
  // is exclusive → the 100000–999999 six-digit space, unbiased.
  return String(randomInt(100000, 1000000));
}

export type OtpMode = 'demo' | 'production';

/** C9: whether a real SMS/WhatsApp delivery provider is configured. When true,
 * demo mode (which surfaces OTP codes) must never be active regardless of what
 * the DB otpMode says. */
export function realOtpDeliveryConfigured(): boolean {
  return DELIVERY_IS_REAL;
}

export async function getOtpMode(): Promise<OtpMode> {
  let mode: OtpMode = OTP_DEMO_MODE ? 'demo' : 'production';
  try {
    const cfg = await getPlatformSecurity();
    const m = (cfg as Record<string, unknown>).otpMode;
    if (m === 'demo' || m === 'production') mode = m;
  } catch { /* fall through to the env default */ }
  // C9: the boot guard only inspects env, but getOtpMode resolves from the DB,
  // which takes precedence and is flippable at runtime from /platform/security.
  // Enforce the same invariant at the point of use: a real provider forbids
  // demo, so live OTP codes can never be surfaced by toggling the DB value.
  if (mode === 'demo' && DELIVERY_IS_REAL) {
    log.error(
      '[otp] ignoring otpMode=demo: a real SMS/WhatsApp provider is configured; ' +
        'forcing production mode so live OTP codes are not surfaced.'
    );
    return 'production';
  }
  return mode;
}

export async function setOtpMode(mode: OtpMode): Promise<OtpMode> {
  const m: OtpMode = mode === 'production' ? 'production' : 'demo';
  // C9: refuse to persist demo mode while a real provider is configured.
  if (m === 'demo' && DELIVERY_IS_REAL) {
    throw new Error(
      'Cannot enable OTP demo mode while a real SMS/WhatsApp provider is configured — ' +
        'it would surface live OTP codes in API responses and logs.'
    );
  }
  await setPlatformSecurity({ otpMode: m } as unknown as Parameters<typeof setPlatformSecurity>[0]);
  return m;
}

async function sendMsg91OtpDirect(phone: string, code: string): Promise<boolean> {
  // H26: canonical credential is MSG91_AUTH_KEY (the spelling in the deploy
  // production example, both deploy docs, and the notifier). Fall back to the
  // legacy MSG91_AUTHKEY so an existing deploy setting the old name keeps working.
  const authkey = process.env.MSG91_AUTH_KEY ?? process.env.MSG91_AUTHKEY;
  if (!authkey) { log.error('[otp] MSG91_AUTH_KEY missing; cannot send production OTP'); return false; }
  const mobile = phone.replace(/[^0-9]/g, '');
  // SendOTP template: MSG91_TEMPLATE_ID, else the documented MSG91_DLT_TEMPLATE_ID.
  const templateId = process.env.MSG91_TEMPLATE_ID || process.env.MSG91_DLT_TEMPLATE_ID;
  try {
    const params = new URLSearchParams({ otp_expiry: '5', mobile, otp: code });
    if (templateId) params.set('template_id', templateId);
    const res = await fetch(`https://control.msg91.com/api/v5/otp?${params.toString()}`, {
      method: 'POST',
      headers: { authkey, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const t = await res.text();
    const ok = res.ok && t.replace(/\s/g, '').toLowerCase().includes('"type":"success"');
    if (ok) log.info({ mobile }, '[otp] MSG91 SendOTP ok');
    else log.error({ status: res.status, body: t.slice(0, 200) }, '[otp] MSG91 SendOTP failed');
    return ok;
  } catch (e) {
    log.error({ err: (e as Error).message }, '[otp] MSG91 SendOTP error');
    return false;
  }
}

/**
 * Send the OTP over the configured channel(s). `meta.otpCode` lets the WhatsApp
 * template adapter drop the code into an Authentication-template parameter. In
 * demo/mock mode every channel resolves to the mock adapter (code still
 * surfaced via devCode), so this is a no-op change for demos.
 */
async function deliverOtp(phone: string, code: string, demo: boolean): Promise<{ ok: boolean }> {
  // H25: return the real delivery outcome instead of discarding it. The notifier
  // falls through to a mock that reports ok:true when no provider key is set, so
  // the caller (sendOtp) must decide — in production with a real provider a
  // non-ok send is a hard failure, not a silent "sent".
  if (demo) return { ok: true };
  if (await sendMsg91OtpDirect(phone, code)) return { ok: true };
  const body = `Your verification code is ${code}. It expires in 5 minutes.`;
  const meta = { otpCode: code };
  const sms = () => notify.sms({ to: phone, body, template: 'otp.login', meta });
  const wa = () => notify.whatsapp({ to: phone, body, template: 'otp.login', meta });
  switch (OTP_CHANNEL) {
    case 'whatsapp': {
      const r = await wa();
      return { ok: Boolean(r?.ok) };
    }
    case 'both': {
      const rs = await Promise.allSettled([wa(), sms()]);
      return { ok: rs.some((x) => x.status === 'fulfilled' && Boolean(x.value?.ok)) };
    }
    case 'whatsapp_then_sms': {
      const r = await wa();
      if (r?.ok) return { ok: true };
      const r2 = await sms();
      return { ok: Boolean(r2?.ok) };
    }
    case 'sms_then_whatsapp': {
      const r = await sms();
      if (r?.ok) return { ok: true };
      const r2 = await wa();
      return { ok: Boolean(r2?.ok) };
    }
    case 'sms':
    default: {
      const r = await sms();
      return { ok: Boolean(r?.ok) };
    }
  }
}
/** Friendly "in X" rendering for the rate-limit message. Avoids confusion
 *  like "Try tomorrow" when the counter is a rolling 24h window — we tell
 *  the user the actual time remaining instead. */
function humanWait(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 60 * 60) return `${Math.ceil(seconds / 60)} min`;
  const hours = Math.ceil(seconds / 3600);
  return hours === 1 ? '1 hour' : `${hours} hours`;
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
/** H25: thrown when a real provider could not deliver the OTP in production, so
 * the caller never reports a false "sent". */
export class OtpDeliveryError extends Error {}
/**
 * Request an OTP. Throws `OtpRateLimitedError` if any of the limits are tripped.
 * `ipAddress` is required in production paths so the per-IP throttle works.
 */
export async function sendOtp(args: { phone: string; purpose?: string; ipAddress?: string }): Promise<{ ok: true; devCode?: string }> {
  const purposeEnum = normalizePurposeEnum(args.purpose);
  // H20: canonicalize the purpose used for OtpToken storage AND every cooldown /
  // count query. Previously the raw free-form string was used, so rotating it
  // ('login','login1','LOGIN',…) minted a fresh counter bucket each time and
  // bypassed the 45s cooldown and the per-phone hour/day caps. Lowercasing the
  // enum keeps the stored format compatible with existing rows.
  const purpose = purposeEnum.toLowerCase();
  const demo = (await getOtpMode()) === 'demo';
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
  // Resend cooldown  compare with the latest OtpToken creation
  const latest = await prisma.otpToken.findFirst({
    where: { phone: args.phone, purpose },
    orderBy: { createdAt: 'desc' }
  });
  if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000);
    throw new OtpRateLimitedError(wait, `Please wait ${wait}s before requesting another code.`);
  }
  // ── Abuse-protection limits ────────────────────────────────────────────────
  // Skipped when:
  //   • OTP_DEMO_MODE is on — no real SMS leaves the system, so abuse
  //     protection is meaningless and only breaks the demo experience.
  //   • OTP_RATE_LIMITS_DISABLED=true — explicit escape hatch for staging,
  //     load tests, etc. Production should NEVER set this.
  // Resend cooldown + lockout still apply above; those are UX guards (not SMS
  // cost guards) and stay on in every environment.
  if (!demo && !RATE_LIMITS_DISABLED) {
    // Per-phone window limits
    const sentInLastHour = await prisma.otpToken.count({ where: { phone: args.phone, purpose, createdAt: { gte: hourAgo } } });
    if (sentInLastHour >= MAX_OTP_PER_HOUR_PHONE) {
      // Figure out when the oldest in-window code drops out — that's the real
      // retry-after, not a flat 60 minutes.
      const oldestInHour = await prisma.otpToken.findFirst({
        where: { phone: args.phone, purpose, createdAt: { gte: hourAgo } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const wait = oldestInHour
        ? Math.max(60, Math.ceil((oldestInHour.createdAt.getTime() + 60 * 60 * 1000 - now.getTime()) / 1000))
        : 60 * 60;
      throw new OtpRateLimitedError(wait, `Too many code requests this hour. Try again in ${humanWait(wait)}.`);
    }
    const sentInLastDay = await prisma.otpToken.count({ where: { phone: args.phone, purpose, createdAt: { gte: dayAgo } } });
    if (sentInLastDay >= MAX_OTP_PER_DAY_PHONE) {
      const oldestInDay = await prisma.otpToken.findFirst({
        where: { phone: args.phone, purpose, createdAt: { gte: dayAgo } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      const wait = oldestInDay
        ? Math.max(60, Math.ceil((oldestInDay.createdAt.getTime() + 24 * 60 * 60 * 1000 - now.getTime()) / 1000))
        : 24 * 60 * 60;
      throw new OtpRateLimitedError(wait, `Daily code limit reached. Try again in ${humanWait(wait)}.`);
    }
    // Per-IP window limit
    if (args.ipAddress) {
      const sentByIp = await prisma.otpAttempt.aggregate({
        where: { ipAddress: args.ipAddress, createdAt: { gte: hourAgo } },
        _sum: { sentCount: true }
      });
      if ((sentByIp._sum.sentCount ?? 0) >= MAX_OTP_PER_HOUR_IP) {
        throw new OtpRateLimitedError(60 * 60, 'Too many requests from this network. Try again in an hour.');
      }
    }
    // Platform-wide SMS daily budget  flat ceiling so a bug can't drain SMS credit
    const sentTodayAll = await prisma.otpToken.count({ where: { createdAt: { gte: dayAgo } } });
    if (sentTodayAll >= SMS_DAILY_BUDGET) {
      log.error({ sentTodayAll, SMS_DAILY_BUDGET }, 'SMS daily budget reached  refusing further OTPs');
      throw new OtpRateLimitedError(60 * 60, 'Verification temporarily unavailable. Please try again later.');
    }
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
        ipAddress: args.ipAddress ?? tracker.ipAddress
        // H21: do NOT reset `attempts` here. It is the failed-verify counter that
        // drives the 30-min lockout; resetting it on every send let an attacker
        // fail 4×, request a fresh code, and never trip the lockout. It is reset
        // only on a successful verify.
      }
    })
  ]);
  const delivery = await deliverOtp(args.phone, code, demo);
  // H25: never report a false "sent". With a real provider in production, a
  // failed delivery is a hard error rather than the mock-success fallback.
  if (!demo && IS_PROD && DELIVERY_IS_REAL && !delivery.ok) {
    throw new OtpDeliveryError('Could not send the verification code right now. Please try again.');
  }
  // Surface the code only when it's safe to do so:
  //   - Demo mode (OTP_DEMO_MODE/OTP_DEBUG_LOG) with a mock SMS provider  the
  //     real-provider + demo combination is rejected at module load above, so
  //     reaching here in demo mode guarantees there are no real users to leak.
  //   - Local dev convenience (non-production), regardless of flag.
  // With a real SMS provider in production, the code is NEVER logged or returned.
  if (demo) {
    log.info({ phone: args.phone, purpose, code }, 'OTP issued (demo mode  code surfaced)');
    return { ok: true, devCode: code };
  }
  if (!IS_PROD) {
    return { ok: true, devCode: code };
  }
  return { ok: true };
}
export async function verifyOtp(args: { phone: string; code: string; purpose?: string }): Promise<boolean> {
  // H20: use the same canonical purpose the token was stored under.
  const purposeEnum = normalizePurposeEnum(args.purpose);
  const purpose = purposeEnum.toLowerCase();
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
