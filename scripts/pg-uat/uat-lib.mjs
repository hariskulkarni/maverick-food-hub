// Flavrly PG local synthetic UAT — shared client helpers (Node 20, run from apps/web so
// `otplib` resolves). Every HTTP call is logged (method, path, status, redacted body) to the
// current scenario's evidence folder. Secrets never reach the logs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { authenticator } = require('otplib');

export const APP = 'http://localhost:3311';
export const GW = 'http://127.0.0.1:6611';
export const GW_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';
const UAT_DIR = process.env.UAT_DIR;
const EVID = process.env.EVID || '/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s';

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(path.join(UAT_DIR, file), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const gwEnv = readEnv('gw.env');
const appEnv = readEnv('app.env');
const SECRETS = [gwEnv.ADMIN_API_TOKEN, appEnv.INTERNAL_CRON_SECRET, appEnv.NEXTAUTH_SECRET, readEnv('gw-merchant.env').MERCHANT_SECRET].filter(Boolean);
export const staff = JSON.parse(fs.readFileSync(path.join(UAT_DIR, 'staff.json'), 'utf8'));
for (const s of Object.values(staff)) SECRETS.push(s.password, s.totp);

let scenarioDir = path.join(EVID, 'misc');
export function scenario(name) {
  scenarioDir = path.join(EVID, name);
  fs.mkdirSync(scenarioDir, { recursive: true });
  note(`==== ${name} @ ${new Date().toISOString()}`);
  return scenarioDir;
}
export function redact(s) {
  let out = String(s);
  for (const x of SECRETS) if (x) out = out.split(x).join('***');
  return out
    .replace(/whsec_[A-Za-z0-9+/=]+/g, 'whsec_***')
    .replace(/("(?:token|sessionToken|devCode|csrfToken|secret)"\s*:\s*")[^"]*"/g, '$1***"');
}
export function note(line) {
  const l = redact(line);
  console.log(l);
  fs.appendFileSync(path.join(scenarioDir, 'run.log'), l + '\n');
}
export function save(file, data) {
  fs.writeFileSync(path.join(scenarioDir, file), redact(typeof data === 'string' ? data : JSON.stringify(data, null, 2)) + '\n');
}

export class Jar {
  constructor(label) { this.label = label; this.c = new Map(); }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
  take(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [kv] = sc.split(';');
      const i = kv.indexOf('=');
      this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }
}

export async function http(method, url, { jar, body, headers = {}, form, label, quiet } = {}) {
  const h = { ...headers };
  if (jar && jar.c.size) h.cookie = jar.header();
  let payload;
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  let res;
  for (let i = 0; ; i++) {
    try { res = await fetch(url, { method, headers: h, body: payload, redirect: 'manual' }); break; }
    catch (e) { if (i >= 3) throw e; note(`(transport error ${e.cause?.code ?? e.message} on ${method} ${url}; retry ${i + 1})`); await new Promise((r) => setTimeout(r, 1500)); }
  }
  if (jar) jar.take(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!quiet) note(`HTTP ${method} ${url.replace(/^https?:\/\/[^/]+/, '')} [${label ?? jar?.label ?? '-'}] -> ${res.status} ${text.slice(0, 600).replace(/\s+/g, ' ')}`);
  return { status: res.status, json, text, headers: res.headers };
}

export const gwAdmin = (method, p, body) =>
  http(method, GW + p, { body, label: 'gw-admin', headers: { authorization: `Bearer ${gwEnv.ADMIN_API_TOKEN}`, 'x-merchant-id': GW_MERCHANT_ID } });

export const worker = () =>
  http('POST', `${APP}/api/platform/jobs/pg-worker/run`, { label: 'cron', headers: { 'x-internal-secret': appEnv.INTERNAL_CRON_SECRET } });

async function csrf(jar) {
  const r = await http('GET', `${APP}/api/auth/csrf`, { jar, quiet: true });
  return r.json.csrfToken;
}

export async function staffLogin(key) {
  const s = staff[key];
  const jar = new Jar(key);
  const csrfToken = await csrf(jar);
  const r = await http('POST', `${APP}/api/auth/callback/email-password`, {
    jar,
    form: { email: s.email, password: s.password, totp: authenticator.generate(s.totp), csrfToken, callbackUrl: `${APP}/` },
    quiet: true,
  });
  const me = await http('GET', `${APP}/api/auth/session`, { jar, quiet: true });
  note(`login staff ${key} (${s.email}) -> ${r.status}, session role=${me.json?.user?.role ?? 'NONE'}`);
  if (!me.json?.user) throw new Error(`staff login failed for ${key}`);
  return jar;
}

export async function customerLogin(phone) {
  const jar = new Jar(`cust:${phone}`);
  const otp = await http('POST', `${APP}/api/auth/otp`, { jar, body: { phone }, quiet: true });
  const code = otp.json?.devCode;
  const csrfToken = await csrf(jar);
  const r = await http('POST', `${APP}/api/auth/callback/phone-otp`, { jar, form: { phone, code, purpose: 'login', csrfToken, callbackUrl: `${APP}/` }, quiet: true });
  const me = await http('GET', `${APP}/api/auth/session`, { jar, quiet: true });
  note(`login customer ${phone} -> otp ${otp.status}, callback ${r.status}, session role=${me.json?.user?.role ?? 'NONE'} id=${me.json?.user?.id}`);
  if (!me.json?.user) throw new Error(`customer login failed for ${phone}`);
  jar.userId = me.json.user.id;
  return jar;
}

export function sql(query) {
  return execFileSync('psql', ['-h', 'localhost', '-p', '55432', '-U', 'ci', '-d', 'ci_uat', '-X', '-P', 'pager=off', '-c', query], { encoding: 'utf8' });
}
export function sqlVal(query) {
  return execFileSync('psql', ['-h', 'localhost', '-p', '55432', '-U', 'ci', '-d', 'ci_uat', '-X', '-At', '-c', query], { encoding: 'utf8' }).trim();
}
export function snap(file, query) {
  const out = sql(query);
  fs.appendFileSync(path.join(scenarioDir, file), redact(`-- ${query}\n${out}\n`));
  return out;
}

/** Full DB picture for one order: order, payment(s), attempt(s), evidence, bank txns, allocations, outbox, exceptions. */
export function snapOrder(file, orderId) {
  const o = `'${orderId}'`;
  snap(file, `select id, code, status, total, "paymentMethod" from "Order" where id=${o}`);
  snap(file, `select id, status, amount, "providerName", "providerRef" from "Payment" where "orderId"=${o} order by "createdAt"`);
  snap(file, `select id, state, "attemptKey", "gatewayPaymentId", "expectedAmountPaise", "payableAmountPaise", "observedUtr", "expiresAt" from "PgPaymentAttempt" where "orderId"=${o} order by "createdAt"`);
  snap(file, `select e.id, e.source, e.utr, e."observedAmountPaise", e."sourceAuthenticated", e.status, e."dedupeKey" from "PgPaymentEvidence" e join "PgPaymentAttempt" a on a.id=e."attemptId" where a."orderId"=${o} order by e."processedAt"`);
  snap(file, `select b.id, b.source, b.status, b."amountPaise", b."bankReference", b."valueAt" from "PgBankTransaction" b where b."bankReference" in (select "observedUtr" from "PgPaymentAttempt" where "orderId"=${o})`);
  snap(file, `select al.id, al.kind, al."amountPaise", al."bankTransactionId", al."reversedAt" from "PgAllocation" al join "PgPaymentAttempt" a on a.id=al."attemptId" where a."orderId"=${o}`);
  snap(file, `select id, topic, status, attempts, "dedupeKey" from "PgOutbox" where "aggregateId"=${o}`);
  snap(file, `select id, kind, status, "dedupeKey" from "PgReconException" where "orderId"=${o} order by "createdAt"`);
  snap(file, `select "providerEventId", "eventType", processed, attempts, "deadLetteredAt" is not null as dead from "PaymentWebhookEvent" where "orderId" in (select "attemptKey" from "PgPaymentAttempt" where "orderId"=${o}) order by "createdAt"`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, { timeoutMs = 60000, everyMs = 1000, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(everyMs);
  }
}

// ---------- domain helpers ----------
export const BRANCH_ID = () => sqlVal(`select id from "Branch" where slug='saffron-smoke-indiranagar'`);
export const RESTAURANT_ID = () => sqlVal(`select id from "Restaurant" where slug='saffron-smoke'`);

/** Customer places a Flavrly PG order (PICKUP, one item). Returns the /api/orders JSON. */
export async function placePgOrder(cust, menuItemId, quantity = 1) {
  const r = await http('POST', `${APP}/api/orders`, {
    jar: cust,
    body: { branchId: BRANCH_ID(), items: [{ menuItemId, quantity }], paymentMethod: 'PHONEPE', paymentRail: 'youpi', fulfillmentType: 'PICKUP' },
  });
  return r;
}

/** Gateway-side payer journey: register a (fictitious) gateway customer and bind to the session -> ACTIVE. */
export async function gatewayPayerActivate(sessionId, mobile) {
  const reg = await http('POST', `${GW}/api/v1/customer/register`, {
    label: 'gw-payer',
    body: { name: `UAT Payer ${mobile.slice(-3)}`, mobileNumber: mobile, email: `payer${mobile}@example.invalid`, password: 'uat-only-pw' },
  });
  let token = reg.json?.token;
  if (!token) {
    const login = await http('POST', `${GW}/api/v1/customer/login`, { label: 'gw-payer', body: { identifier: mobile, password: 'uat-only-pw' } });
    token = login.json?.token;
  }
  await http('POST', `${GW}/api/v1/checkout/${sessionId}/bind-customer`, { label: 'gw-payer', body: { token }, headers: { authorization: `Bearer ${token}` } });
  const st = await http('GET', `${GW}/api/v1/checkout/${sessionId}/state`, { label: 'gw-payer' });
  return st.json;
}

/** Synthetic bank alert via the fork's documented Developer Test Mode simulator (admin token, dev runtime). */
export async function gatewaySimulatePaid(sessionId, payableRupees, utr) {
  await gwAdmin('POST', '/api/v1/admin/dev/test-mode', { enabled: true });
  return gwAdmin('POST', '/api/v1/admin/dev/simulator/inject', {
    paymentSessionId: sessionId,
    source: 'SMS',
    sender: 'HDFCBK',
    content: `A/C XX9999 credited with Rs ${payableRupees} CR. Ref ${utr} (SYNTHETIC UAT)`,
  });
}

/** Operator (restaurant ADMIN) imports a CSV statement with given credit rows. */
export async function importStatement(adminJar, receivingAccountId, rows, fileName) {
  const lines = ['Txn Date,Narration,Ref No,Withdrawal,Deposit'];
  for (const r of rows) lines.push(`${r.date},UPI CR SYNTHETIC UAT,${r.ref},,${r.amount}`);
  const content = lines.join('\n') + '\n';
  save(`${fileName}`, content);
  return http('POST', `${APP}/api/admin/pg/statements`, {
    jar: adminJar,
    body: {
      receivingAccountId,
      fileName,
      content,
      mapping: { date: 'Txn Date', narration: 'Narration', reference: 'Ref No', credit: 'Deposit', debit: 'Withdrawal', dateFormat: 'YYYY-MM-DD' },
    },
  });
}

export async function kitchenOrderIds(kitchenJar) {
  const r = await http('GET', `${APP}/api/kitchen/orders`, { jar: kitchenJar, quiet: true });
  const ids = (r.json?.orders ?? []).map((o) => o.id);
  note(`GET /api/kitchen/orders [kitchen] -> ${r.status} (${ids.length} active orders)`);
  return ids;
}

export function todayIst() {
  return new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
}

/** Replays a request captured by tap-proxy.mjs, byte-for-byte, straight to the app. `mutate` may alter it. */
export async function replayCaptured(file, label, mutate) {
  const cap = JSON.parse(fs.readFileSync(path.join(UAT_DIR, 'tap', file), 'utf8'));
  const headers = {};
  for (const k of ['content-type', 'webhook-id', 'webhook-timestamp', 'webhook-signature', 'x-gateway-event', 'x-gateway-delivery-id', 'x-gateway-timestamp', 'x-gateway-signature', 'user-agent']) {
    if (cap.headers[k]) headers[k] = cap.headers[k];
  }
  let body = Buffer.from(cap.bodyB64, 'base64');
  if (mutate) body = mutate(headers, body) ?? body; // may edit headers in place and/or return a new body
  const res = await fetch(`${APP}${cap.url}`, { method: 'POST', headers, body });
  const text = await res.text();
  const ageS = Math.round(Date.now() / 1000 - Number(headers['webhook-timestamp']));
  note(`REPLAY ${label}: captured ${file} (webhook-id=${headers['webhook-id']}, signed ${ageS}s ago) -> ${res.status} ${text.slice(0, 200)}`);
  return { status: res.status, text };
}
export function tapFiles() {
  return fs.readdirSync(path.join(UAT_DIR, 'tap')).sort();
}
export function tapMode(m) {
  fs.writeFileSync(path.join(UAT_DIR, 'tap.mode'), m + '\n');
  note(`tap mode := ${m}`);
}
export function tapRead(file) {
  return JSON.parse(fs.readFileSync(path.join(UAT_DIR, 'tap', file), 'utf8'));
}

/** Menu item id by name on the UAT branch (ids are regenerated by every seed). */
export function item(name) {
  return sqlVal(`select id from "MenuItem" where "branchId"=(select id from "Branch" where slug='saffron-smoke-indiranagar') and name='${name.replace(/'/g, "''")}' limit 1`);
}
