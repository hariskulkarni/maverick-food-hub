/**
 * PhonePe UAT sandbox runner — drives a real payment end to end against
 * PhonePe's pre-production environment.
 *
 * This deliberately imports the SHIPPED client (`src/server/payments/phonepe-api.ts`)
 * rather than re-implementing the calls, so a green run is evidence about the
 * code that actually takes money — not about a parallel test harness that
 * happens to agree with it. Nothing here touches the database, Next.js or
 * Prisma; it is pure HTTP, so it runs without a DATABASE_URL.
 *
 * Usage — credentials come from the environment (never pass secrets as argv,
 * they end up in your shell history):
 *
 *   export PHONEPE_CLIENT_ID=...
 *   export PHONEPE_CLIENT_SECRET=...
 *   export PHONEPE_CLIENT_VERSION=1
 *   export PHONEPE_ENV=SANDBOX
 *
 *   npm --prefix apps/web run uat:phonepe -- --auth-only
 *   npm --prefix apps/web run uat:phonepe
 *   npm --prefix apps/web run uat:phonepe -- --amount 199.50 --refund
 *
 * Flags:
 *   --auth-only        stop after fetching a token (cheapest credential check)
 *   --amount <rupees>  default 1.00 (PhonePe's floor)
 *   --refund           after a COMPLETED payment, refund it and poll to settled
 *   --redirect <url>   override the return URL sent to PhonePe
 *   --timeout <sec>    how long to wait for you to finish paying (default 300)
 *
 * The PayPage step needs a human: the script prints a URL, you open it and pay
 * with a sandbox instrument, and it polls Order Status until terminal.
 *
 * Sandbox test instruments (from PhonePe's UAT docs):
 *   Credit card  4208 5851 9011 6667   exp 06/2027   CVV 508
 *   Debit  card  4242 4242 4242 4242   exp 12/2027   CVV 936
 *   OTP          123456
 *   UPI          PhonePe Simulator app (Android pkg com.phonepe.simulator);
 *                for UPI QR, scan with a real UPI app and pick the outcome.
 */

import crypto from 'node:crypto';
import {
  createPayment,
  createRefund,
  getAccessToken,
  getOrderStatus,
  getRefundStatus,
  phonePeBaseUrls,
  phonePeCheckoutScriptUrl,
  PhonePeError,
  toPaisa,
  type PhonePeConfig,
} from '../src/server/payments/phonepe-api';
import { phonePeErrorMessage, toPhonePeState } from '../src/server/payments/phonepe-events';

// ─── CLI ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
function opt(flag: string, fallback?: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const AUTH_ONLY = has('--auth-only');
const DO_REFUND = has('--refund');
const AMOUNT = Number(opt('--amount', '1'));
const TIMEOUT_SEC = Number(opt('--timeout', '300'));
const REDIRECT = opt('--redirect', 'https://flavrly.in/api/payments/phonepe/return');

// ─── Pretty output ──────────────────────────────────────────────────────────

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
let step = 0;
const head = (t: string) => console.log(`\n${C.bold(`[${++step}] ${t}`)}`);
const ok = (t: string) => console.log(`    ${C.green('✓')} ${t}`);
const info = (t: string) => console.log(`    ${C.dim(t)}`);
const warn = (t: string) => console.log(`    ${C.yellow('!')} ${t}`);
const fail = (t: string) => console.log(`    ${C.red('✗')} ${t}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Config ─────────────────────────────────────────────────────────────────

function loadConfig(): PhonePeConfig {
  const clientId = process.env.PHONEPE_CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      C.red('\nPHONEPE_CLIENT_ID and PHONEPE_CLIENT_SECRET must be set.\n') +
        C.dim(
          'Get them from PhonePe Business Dashboard → Developer Settings → API Keys.\n' +
            'These are V2 (OAuth) credentials — the legacy Merchant ID + Salt Key pair\n' +
            'will not work against these endpoints.\n',
        ),
    );
    process.exit(2);
  }
  const env = (process.env.PHONEPE_ENV || 'SANDBOX').toUpperCase() === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX';
  if (env === 'PRODUCTION' && !has('--i-know-this-is-production')) {
    console.error(
      C.red('\nPHONEPE_ENV=PRODUCTION — refusing to run.\n') +
        C.dim('This script moves real money in production. Re-run with --i-know-this-is-production if you truly mean it.\n'),
    );
    process.exit(2);
  }
  return {
    clientId,
    clientSecret,
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || '1',
    env,
  };
}

// ─── Run ────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = loadConfig();
  const urls = phonePeBaseUrls(cfg.env);

  console.log(C.bold('\nPhonePe UAT runner'));
  info(`environment   ${cfg.env}`);
  info(`auth host     ${urls.auth}`);
  info(`api  host     ${urls.api}`);
  info(`checkout.js   ${phonePeCheckoutScriptUrl(cfg.env)}`);
  info(`client id     ${cfg.clientId.slice(0, 6)}…  version ${cfg.clientVersion}`);

  // ── 1. Authorization ──────────────────────────────────────────────────────
  head('Fetch OAuth token');
  const t0 = Date.now();
  let token: string;
  try {
    token = await getAccessToken(cfg, true);
  } catch (e) {
    const err = e as PhonePeError;
    fail(`${err.code} — ${err.message}`);
    if (err.httpStatus === 401) {
      info('401 means the client id / secret / version triple was rejected. Check all three.');
    }
    if (String(err.code).includes('404') || /mapping/i.test(err.message)) {
      info('"Api Mapping Not Found" usually means V1 salt credentials on a V2 endpoint.');
    }
    process.exit(1);
  }
  ok(`token acquired in ${Date.now() - t0}ms (${token.slice(0, 12)}…)`);

  if (AUTH_ONLY) {
    console.log(C.green('\nCredentials are valid. Stopping here (--auth-only).\n'));
    return;
  }

  // ── 2. Create payment ─────────────────────────────────────────────────────
  head('Create payment');
  if (!(AMOUNT > 0)) {
    fail(`--amount must be > 0 (got ${AMOUNT})`);
    process.exit(2);
  }
  // Same shape the app mints: <id>-<attempt>. Random id so reruns never collide.
  const merchantOrderId = `uat-${crypto.randomBytes(6).toString('hex')}-1`;
  info(`merchantOrderId  ${merchantOrderId}`);
  info(`amount           ₹${AMOUNT.toFixed(2)}  (${toPaisa(AMOUNT)} paisa)`);
  info(`redirectUrl      ${REDIRECT}?ref=${merchantOrderId}`);

  let pay;
  try {
    pay = await createPayment(cfg, {
      merchantOrderId,
      amountPaisa: toPaisa(AMOUNT),
      redirectUrl: `${REDIRECT}?ref=${merchantOrderId}`,
      expireAfter: Math.min(3600, Math.max(300, TIMEOUT_SEC)),
      message: 'Flavrly UAT check',
      metaInfo: { udf1: merchantOrderId, udf2: 'uat-runner' },
    });
  } catch (e) {
    const err = e as PhonePeError;
    fail(`${err.code} — ${err.message}`);
    if (/INTERNAL_SECURITY_BLOCK_1/.test(JSON.stringify(err.data ?? ''))) {
      info('The redirect host is not the domain onboarded on this merchant account.');
    }
    process.exit(1);
  }
  ok(`order created — PhonePe orderId ${pay.orderId}, state ${pay.state}`);
  if (pay.expireAt) info(`expires at       ${new Date(pay.expireAt).toISOString()}`);

  console.log(`\n${C.bold('Open this PayPage and pay:')}\n\n  ${C.cyan(pay.redirectUrl)}\n`);
  console.log(
    C.dim(
      '  Sandbox instruments:\n' +
        '    credit  4208 5851 9011 6667   exp 06/2027   CVV 508\n' +
        '    debit   4242 4242 4242 4242   exp 12/2027   CVV 936\n' +
        '    OTP     123456\n' +
        '  The sandbox lets you choose the outcome: success, failure or pending.\n',
    ),
  );

  // ── 3. Poll order status ──────────────────────────────────────────────────
  head('Poll Order Status until terminal');
  info(`waiting up to ${TIMEOUT_SEC}s — Ctrl-C to stop\n`);

  const started = Date.now();
  let last = '';
  let final: Awaited<ReturnType<typeof getOrderStatus>> | null = null;

  while (Date.now() - started < TIMEOUT_SEC * 1000) {
    let st;
    try {
      st = await getOrderStatus(cfg, merchantOrderId);
    } catch (e) {
      // Transport failure is not a payment failure — keep waiting.
      warn(`status lookup failed (${(e as Error).message}) — retrying`);
      await sleep(3000);
      continue;
    }
    if (st.state !== last) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`    ${C.dim(`+${String(secs).padStart(3)}s`)}  state → ${C.bold(st.state)}`);
      last = st.state;
    }
    if (toPhonePeState(st.state) !== 'PENDING') {
      final = st;
      break;
    }
    await sleep(2500);
  }

  if (!final) {
    warn(`still PENDING after ${TIMEOUT_SEC}s — in the app the reconciliation sweep would keep watching.`);
    process.exit(3);
  }

  const attempt = (final.paymentDetails ?? [])[0];
  if (toPhonePeState(final.state) === 'COMPLETED') {
    ok(`payment COMPLETED`);
    info(`transactionId  ${attempt?.transactionId ?? '(none)'}`);
    info(`paymentMode    ${attempt?.paymentMode ?? '(none)'}`);
    info(`amount         ${final.amount} paisa   fee ${final.feeAmount ?? 0} paisa`);
    if (attempt?.rail) info(`rail           ${JSON.stringify(attempt.rail)}`);
    if (attempt?.instrument) info(`instrument     ${JSON.stringify(attempt.instrument)}`);
  } else {
    fail(`payment ${final.state}`);
    info(`errorCode          ${final.errorCode ?? '(none)'}`);
    info(`detailedErrorCode  ${final.detailedErrorCode ?? '(none)'}`);
    info(`customer message   "${phonePeErrorMessage(final.errorCode, final.detailedErrorCode)}"`);
    console.log(C.yellow('\nA failed payment is a valid UAT result — it exercises the failure path.\n'));
    return;
  }

  // ── 4. Refund ─────────────────────────────────────────────────────────────
  if (!DO_REFUND) {
    console.log(C.green('\nDone. Re-run with --refund to also exercise the refund path.\n'));
    return;
  }

  head('Refund the payment');
  const merchantRefundId = `uatr-${crypto.randomBytes(6).toString('hex')}`;
  info(`merchantRefundId ${merchantRefundId}`);
  let refund;
  try {
    refund = await createRefund(cfg, {
      merchantRefundId,
      originalMerchantOrderId: merchantOrderId,
      amountPaisa: toPaisa(AMOUNT),
    });
  } catch (e) {
    const err = e as PhonePeError;
    fail(`${err.code} — ${err.message}`);
    process.exit(1);
  }
  ok(`refund accepted — PhonePe refundId ${refund.refundId}, state ${refund.state}`);

  head('Poll Refund Status until settled');
  const rStarted = Date.now();
  let rLast = '';
  while (Date.now() - rStarted < TIMEOUT_SEC * 1000) {
    let rs;
    try {
      rs = await getRefundStatus(cfg, merchantRefundId);
    } catch (e) {
      warn(`refund status lookup failed (${(e as Error).message}) — retrying`);
      await sleep(3000);
      continue;
    }
    if (rs.state !== rLast) {
      const secs = Math.round((Date.now() - rStarted) / 1000);
      console.log(`    ${C.dim(`+${String(secs).padStart(3)}s`)}  state → ${C.bold(rs.state)}`);
      rLast = rs.state;
    }
    if (toPhonePeState(rs.state) !== 'PENDING') {
      if (toPhonePeState(rs.state) === 'COMPLETED') {
        ok('refund COMPLETED');
        console.log(C.green('\nFull round trip verified: auth → pay → capture → refund.\n'));
      } else {
        fail(`refund ${rs.state} — ${phonePeErrorMessage(rs.errorCode, rs.detailedErrorCode)}`);
      }
      return;
    }
    await sleep(3000);
  }
  warn('refund still PENDING — PhonePe settles some rails asynchronously; the sweep would confirm it.');
}

main().catch((e) => {
  console.error(C.red(`\nUnexpected failure: ${(e as Error).stack ?? e}\n`));
  process.exit(1);
});
