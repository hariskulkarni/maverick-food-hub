/**
 * Integrated demo story (LOCAL ONLY): Flavrly ↔ Novaryq India, recorded with system Chrome.
 * Every screenshot is saved as frames/NN-<slug>-<width>.png and captioned in frames.json; every
 * browser context records a video. Run by up.sh (`run-demo`), never against production.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { authenticator } from 'otplib';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const E = process.env;
const FL = E.FL_URL ?? 'http://localhost:3100';
const NQ_WEB = E.NQ_WEB ?? 'http://localhost:5173';
const OUT = E.DEMO_OUT ?? 'demo-out';
const FRAMES = `${OUT}/frames`;
mkdirSync(FRAMES, { recursive: true });
mkdirSync(`${OUT}/video`, { recursive: true });
// DEMO_APPEND=1 adds frames to an existing evidence folder (a re-recorded stage) instead of starting over.
const captions: { file: string; caption: string }[] =
  E.DEMO_APPEND === '1' && existsSync(`${OUT}/frames.json`) ? JSON.parse(readFileSync(`${OUT}/frames.json`, 'utf8')) : [];
let n = captions.length;

async function shot(page: Page, slug: string, caption: string, fullPage = false) {
  n += 1;
  const w = page.viewportSize()?.width ?? 0;
  const file = `${String(n).padStart(2, '0')}-${slug}-${w}.png`;
  await page.screenshot({ path: `${FRAMES}/${file}`, fullPage });
  captions.push({ file, caption });
  writeFileSync(`${OUT}/frames.json`, JSON.stringify(captions, null, 2));
}

/** Runs a later story stage; a failure is recorded in story.log + a frame, and the story continues. */
const failedStages: string[] = [];
async function stage(name: string, page: Page | null, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    failedStages.push(name);
    note(`STAGE FAILED: ${name}: ${(e as Error).message.split('\n')[0].slice(0, 300)}`);
    if (page) await shot(page, `failed-${name}`, `Stage "${name}" did not complete — see story.log.`).catch(() => undefined);
  }
}

function note(line: string) {
  appendFileSync(`${OUT}/story.log`, `${new Date().toISOString()} ${line}\n`);
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function context(browser: Browser, size: { width: number; height: number }, name: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: size.width < 500 ? 2 : 1,
    isMobile: size.width < 500,
    hasTouch: size.width < 500,
    recordVideo: { dir: `${OUT}/video/${name}`, size },
  });
  // Each demo person has already answered Flavrly's cookie banner ("Essential only") and the
  // "install the app" nudge, so the overlays do not cover the story (same storage keys the UI writes).
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('flavrly_cookie_consent')) localStorage.setItem('flavrly_cookie_consent', 'essential');
      localStorage.setItem('flavrly_pwa_dismissed', String(Date.now()));
    } catch { /* not a Flavrly origin */ }
  });
  return ctx;
}

async function dismissCookies(page: Page) {
  const b = page.getByRole('button', { name: 'Essential only' });
  if (await b.isVisible().catch(() => false)) await b.click();
}

/**
 * Flavrly staff sign-in: email + password, then TOTP — enrolling on first sign-in exactly as a real
 * owner does (the demo reads the manual-entry key and acts as the authenticator app). A dev-server
 * cold compile can outlast a 30 s TOTP step, so a refused code is retried with a fresh one.
 */
let flTotpSecret = E.FL_ADMIN_TOTP_SECRET ?? '';
async function flavrlyStaffLogin(page: Page) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${FL}/login`);
    await dismissCookies(page);
    await page.getByRole('button', { name: /Restaurant Staff/ }).click();
    await page.locator('#email').fill(E.FL_ADMIN_EMAIL!);
    await page.locator('#password').fill(E.FL_ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#totp').waitFor({ timeout: 300_000 });
    const enrollKey = page.locator('span.font-mono').first();
    if (await enrollKey.isVisible().catch(() => false)) {
      flTotpSecret = (await enrollKey.innerText()).replace(/\s+/g, '');
      note('flavrly admin: TOTP enrolled (local demo secret)');
    }
    await page.locator('#totp').fill(authenticator.generate(flTotpSecret));
    await page.getByRole('button', { name: /Verify/ }).click();
    // Recovery codes are shown once right after enrollment — the owner saves them and continues.
    const saved = page.getByRole('button', { name: /saved them/i });
    const landed = await Promise.race([
      page.waitForURL(/\/admin/, { timeout: 300_000, waitUntil: 'commit' }).then(() => 'admin'),
      saved.waitFor({ timeout: 300_000 }).then(() => 'codes'),
    ]).catch(() => 'none');
    if (landed === 'codes') {
      await shot(page, 'flavrly-admin-2fa-recovery-codes', 'Flavrly staff sign-in: Google Authenticator enrolled; one-time recovery codes shown (demo values).');
      await saved.click();
      if (await page.waitForURL(/\/admin/, { timeout: 300_000, waitUntil: 'commit' }).then(() => true, () => false)) return;
    } else if (landed === 'admin') return;
    note(`flavrly admin sign-in attempt ${attempt} did not land on /admin; retrying with a fresh code`);
    await page.waitForTimeout(31_000);
  }
  throw new Error('Flavrly staff sign-in failed');
}

async function novaryqStaffLogin(page: Page) {
  await page.goto(`${NQ_WEB}/admin`);
  await page.locator('#admin-email').fill(E.NQ_OWNER_EMAIL!);
  await page.locator('#admin-password').fill(E.NQ_OWNER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Flavrly Test Kitchen').first()).toBeVisible({ timeout: 60_000 });
}

const NQ_BIZ = E.NQ_BIZ ?? 'http://flavrly-test-kitchen.novaryq.test:5173';

async function customerLogin(page: Page, phone: string) {
  await page.goto(`${FL}/login`);
  await dismissCookies(page);
  await page.locator('#phone').fill(phone.replace(/^\+91/, ''));
  await page.getByRole('button', { name: 'Get OTP' }).click();
  // Test account: Flavrly shows the code on screen instead of sending an SMS.
  const code = (await page.getByText(/your code is \d{6}/).innerText()).match(/\d{6}/)![0];
  await page.locator('input[autocomplete="one-time-code"]').first().fill(code);
  await page.getByRole('button', { name: /Verify & continue/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 300_000 });
}

async function addToCart(page: Page, item: string) {
  const card = page.locator('div,article,li').filter({ visible: true }).filter({ hasText: item }).filter({ has: page.getByRole('button', { name: /^ADD$/i }) }).last();
  await card.getByRole('button', { name: /^ADD$/i }).click();
  // Items with Flavrly-side options open a sheet; take the defaults.
  const sheetAdd = page.getByRole('dialog').getByRole('button', { name: /add to cart|add item|^add/i }).first();
  if (await sheetAdd.isVisible({ timeout: 2_000 }).catch(() => false)) await sheetAdd.click();
}

async function checkout(page: Page, method: 'COD' | 'ONLINE'): Promise<string> {
  await page.goto(`${FL}/cart`);
  const go = page.getByRole('link', { name: /Proceed to checkout|Place order/ }).filter({ visible: true }).first();
  const href = (await go.getAttribute('href')) ?? '/checkout';
  await go.click();
  // A click during hydration on a cold dev server can be swallowed; the link's own href is the same step.
  if (!(await page.waitForURL(/\/checkout/, { timeout: 240_000 }).then(() => true, () => false))) {
    await page.goto(`${FL}${href}`).catch(() => undefined); // may race the late client navigation (ERR_ABORTED)
    await page.waitForURL(/\/checkout/);
  }
  await page.getByRole('button', { name: method === 'COD' ? /Cash on Delivery/ : /Pay online/ }).click();
  await expect(page.getByRole('button', { name: /Place order · ₹[1-9]/ })).toBeVisible();
  await page.getByRole('button', { name: /Place order/ }).click();
  // Normally the checkout routes straight to the tracker. On a cold dev server the client navigation can be
  // lost after the cart is cleared ("Your cart is empty"); the customer then opens My orders → newest order.
  const tracked = await page.waitForURL(/\/orders\/[a-z0-9]+/, { timeout: 240_000, waitUntil: 'commit' }).then(() => true, () => false);
  if (!tracked) {
    note('checkout did not route to the tracker (dev-server navigation lost); opening My orders');
    await page.goto(`${FL}/orders`, { waitUntil: 'domcontentloaded' });
    const first = page.locator('a[href^="/orders/c"]').filter({ visible: true }).first();
    await first.waitFor({ timeout: 300_000 });
    await page.goto(`${FL}${await first.getAttribute('href')}`, { waitUntil: 'domcontentloaded' });
  }
  const id = new URL(page.url()).pathname.split('/').pop()!;
  note(`customer placed ${method} order ${id}`);
  return id;
}

/** The order's Flavrly code (externalCode on the Novaryq ticket), read from the tracker. */
async function orderCode(page: Page): Promise<string> {
  const m = (await page.locator('main').innerText()).match(/\b(?:ORD|FLV)-[A-Z0-9]+\b/);
  return m ? m[0] : '';
}

async function waitForText(page: Page, re: RegExp, reloadEveryMs = 15_000, timeoutMs = 600_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const hit = await page.getByText(re).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: reloadEveryMs }).then(() => true, () => false);
    if (hit) return;
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  throw new Error(`timed out waiting for ${re}`);
}

/** Rider app API (the native rider app's endpoints; the web portal has no delivery screens). */
class RiderApp {
  token = '';
  constructor(private readonly request: import('@playwright/test').APIRequestContext) {}
  private async call(method: string, path: string, data?: unknown) {
    const res = await this.request.fetch(`${FL}${path}`, { method, data, headers: this.token ? { authorization: `Bearer ${this.token}` } : {} });
    const body = await res.json().catch(() => ({}));
    note(`rider app ${method} ${path} -> ${res.status()}`);
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${JSON.stringify(body).slice(0, 300)}`);
    return body as any;
  }
  async login(phone: string) {
    const otp = await this.call('POST', '/api/rider/auth/request-otp', { phone });
    const v = await this.call('POST', '/api/rider/auth/verify-otp', { phone, code: otp.devCode });
    this.token = v.token;
  }
  online() { return this.call('POST', '/api/rider/online', { online: true }); }
  pool() { return this.call('GET', '/api/rider/pool'); }
  claim(orderId: string) { return this.call('POST', `/api/rider/pool/${orderId}/claim`); }
  act(assignmentId: string, action: string, data?: unknown) { return this.call('POST', `/api/rider/assignments/${assignmentId}/${action}`, data); }
}

/** Stage 8: 86 on the Novaryq POS hides the item on Flavrly; Restore brings it back. Returns the POS context. */
async function story86(browser: Browser, c: Page): Promise<BrowserContext> {
  const posCtx = await context(browser, DESKTOP, 'novaryq-pos');
  const pos = await posCtx.newPage();
  await stage('86', pos, async () => {
  await pos.goto(`${NQ_BIZ}/pos`);
  await pos.getByText('Flavrly Test Kitchen — Indiranagar').click();
  for (const d of '1357') await pos.getByRole('button', { name: d, exact: true }).first().click();
  await pos.getByRole('button', { name: 'Sign in' }).click();
  const till = pos.getByRole('button', { name: /Open till/ });
  const fnBtn = pos.getByRole('button', { name: 'Functions' });
  await expect(till.or(fnBtn).first()).toBeVisible();
  if (await till.isVisible().catch(() => false)) {
    await pos.locator('input').first().fill('2000');
    await till.click();
  }
  await pos.getByRole('button', { name: 'Functions' }).click();
  await pos.getByRole('button', { name: /86 items/ }).click();
  await pos.getByPlaceholder('Search menu…').fill('Mango');
  await pos.getByRole('button', { name: /Mango Lassi/ }).first().click();
  await expect(pos.getByText(/Mango Lassi/).first()).toBeVisible();
  await shot(pos, 'novaryq-pos-86', 'Novaryq India POS (manager PIN): Mango Lassi 86\'d at this location.');
  await c.goto(`${FL}/r/${E.FL_RESTAURANT_SLUG ?? 'flavrly-test-kitchen'}`, { waitUntil: 'domcontentloaded' });
  const t86 = Date.now();
  // Orderable = the Mango Lassi card itself (smallest element around its title that has a button) offers ADD.
  const lassiAvailable = () => c.evaluate(() => {
    const title = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span,div')).find(
      (el) => el.childElementCount === 0 && el.textContent?.trim() === 'Mango Lassi' && (el as HTMLElement).offsetParent !== null);
    let card: HTMLElement | null = (title as HTMLElement | undefined)?.parentElement ?? null;
    while (card && !card.querySelector('button')) card = card.parentElement;
    const btn = card ? Array.from(card.querySelectorAll('button')).find((b) => /^\+?\s*ADD$/i.test((b.textContent ?? '').trim())) : undefined;
    return !!btn && !(btn as HTMLButtonElement).disabled;
  });
  while (await lassiAvailable()) { if (Date.now() - t86 > 300_000) break; await c.waitForTimeout(2_000); await c.reload({ waitUntil: 'domcontentloaded' }); }
  await c.reload({ waitUntil: 'load' }).catch(() => undefined);
  await c.waitForTimeout(3_000);
  const off = !(await lassiAvailable());
  // Show the Drinks section (where Mango Lassi lives) rather than the page header.
  await c.getByText(/^Drinks/).filter({ visible: true }).last().scrollIntoViewIfNeeded().catch(() => undefined);
  note(`86 ${off ? 'visible' : 'NOT visible'} on Flavrly after ${Math.round((Date.now() - t86) / 1000)} s`);
  await shot(c, 'flavrly-item-86ed', off
    ? `Flavrly storefront: Mango Lassi can no longer be ordered (${Math.round((Date.now() - t86) / 1000)} s after the 86 — signed menu.item.86ed webhook).`
    : `Flavrly storefront ${Math.round((Date.now() - t86) / 1000)} s after the 86: Mango Lassi still orderable (webhook not applied yet).`);
  await pos.getByRole('button', { name: 'Restore' }).first().click();
  const tr = Date.now();
  await c.reload({ waitUntil: 'domcontentloaded' });
  while (!(await lassiAvailable())) { if (Date.now() - tr > 300_000) break; await c.waitForTimeout(2_000); await c.reload({ waitUntil: 'domcontentloaded' }); }
  const on = await lassiAvailable();
  await c.getByText('Mango Lassi').filter({ visible: true }).last().scrollIntoViewIfNeeded().catch(() => undefined);
  note(`un-86 ${on ? 'visible' : 'NOT visible'} on Flavrly after ${Math.round((Date.now() - tr) / 1000)} s`);
  await shot(c, 'flavrly-item-restored', on
    ? `Restore on the POS: Mango Lassi orderable again on Flavrly (${Math.round((Date.now() - tr) / 1000)} s — menu.item.restored).`
    : `Flavrly ${Math.round((Date.now() - tr) / 1000)} s after the restore: Mango Lassi not back yet.`);
  });

  return posCtx;
}

test('86 only (DEMO_ONLY=86, appended to an existing recording)', async ({ browser }) => {
  test.skip(E.DEMO_ONLY !== '86');
  const custCtx = await context(browser, MOBILE, 'flavrly-customer-86');
  const c = await custCtx.newPage();
  const posCtx = await story86(browser, c);
  await posCtx.close();
  await custCtx.close();
  note(failedStages.length ? `86 pass finished with failed stages: ${failedStages.join(', ')}` : '86 pass finished');
});

test('Flavrly × Novaryq India — integrated demo', async ({ browser, playwright }) => {
  test.skip(!!E.DEMO_ONLY);
  const admin = await context(browser, DESKTOP, 'flavrly-admin');
  const a = await admin.newPage();
  a.on('response', async (r) => {
    if (/\/api\/admin\/integrations\/novaryq/.test(r.url()) && r.request().method() !== 'GET') {
      note(`flavrly admin ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()} ${(await r.text().catch(() => '')).slice(0, 300)}`);
    }
  });

  // ── 1. The restaurant connects Flavrly to its Novaryq India POS (Flavrly admin UI) ──
  if (E.DEMO_SKIP_LINK !== '1') {
  await flavrlyStaffLogin(a);
  await a.goto(`${FL}/admin/integrations`);
  await expect(a.getByText('Novaryq').first()).toBeVisible();
  await a.locator('#nq-url').fill(E.NQ_API!);
  await a.locator('#nq-key').fill(E.NQ_CLIENT_ID!);
  await a.locator('#nq-secret').fill(E.NQ_SECRET!);
  await a.locator('#nq-whsec').fill(E.NQ_WEBHOOK_SECRET!);
  const sw = a.getByRole('switch', { name: 'Send orders to Novaryq' });
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
  await a.getByRole('button', { name: /Test & save/ }).click();
  await expect(a.getByText(/Connected to Novaryq/i).first()).toBeVisible({ timeout: 60_000 });
  await shot(a, 'flavrly-admin-novaryq-connected', 'Flavrly admin → Integrations → Novaryq POS: API key + webhook secret saved, signed test call to Novaryq India succeeded.', true);

  const locInput = a.getByLabel(/Novaryq location id for/).first();
  await locInput.fill(E.NQ_LOCATION_ID!);
  await locInput.locator('xpath=ancestor::*[.//button][1]').getByRole('button', { name: 'Save' }).click();
  await expect(a.getByText(/INR/).first()).toBeVisible({ timeout: 60_000 });
  // QA-D1: the item-mapping card keeps an empty branch id when the first branch is linked in the same
  // page session (Import → 400 "branchId is required"); a reload is the owner-visible workaround.
  await a.reload();
  a.on('dialog', (d) => d.accept());
  await a.getByRole('button', { name: /Import Novaryq menu/ }).click();
  await expect(a.getByText(/Paneer Tikka/).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 });
  await shot(a, 'flavrly-admin-menu-imported', 'Branch linked to the Novaryq India location (currency INR verified) and the Novaryq menu imported into Flavrly; every item linked by Novaryq item code.', true);
  }

  // ── 2. Kitchen: Novaryq KDS (owner session, desktop) ──
  const kitchenCtx = await context(browser, DESKTOP, 'novaryq-kds');
  const kds = await kitchenCtx.newPage();
  await novaryqStaffLogin(kds);
  await kds.goto(`${NQ_WEB}/kds`);
  await expect(kds.getByText('Kitchen Display').first()).toBeVisible();
  await shot(kds, 'novaryq-kds-empty', 'Novaryq India KDS for "Flavrly Test Kitchen — Indiranagar" before any Flavrly order.');

  // ── 3. Customer orders on Flavrly (COD) — phone 390 px, plus the same storefront at 1440 px ──
  const custCtx = await context(browser, MOBILE, 'flavrly-customer');
  const c = await custCtx.newPage();
  await customerLogin(c, E.FL_CUSTOMER_PHONE!);
  await c.goto(`${FL}/r/${E.FL_RESTAURANT_SLUG ?? 'flavrly-test-kitchen'}`);
  await dismissCookies(c);
  await expect(c.getByRole('heading', { name: 'Paneer Tikka' }).first()).toBeVisible();
  await shot(c, 'flavrly-storefront-mobile', 'Customer (phone): the Flavrly storefront shows the menu and prices imported from Novaryq India.');
  const deskCust = await context(browser, DESKTOP, 'flavrly-customer-desktop');
  const cd = await deskCust.newPage();
  await cd.goto(`${FL}/r/${E.FL_RESTAURANT_SLUG ?? 'flavrly-test-kitchen'}`);
  await dismissCookies(cd);
  await expect(cd.getByRole('heading', { name: 'Paneer Tikka' }).first()).toBeVisible();
  await shot(cd, 'flavrly-storefront-desktop', 'Same Flavrly storefront at 1440 px.');

  await addToCart(c, 'Paneer Tikka');
  await addToCart(c, 'Dal Makhani');
  const codOrder = await checkout(c, 'COD');
  await shot(c, 'flavrly-order-placed-cod', 'COD order placed on Flavrly — RECEIVED; the push to Novaryq is queued in the same transaction.');
  const codCode = await orderCode(c);

  // ── 4. The ticket appears on the Novaryq KDS ──
  const codTail = codCode.split('-').pop() ?? codCode;
  await waitForText(kds, new RegExp(codTail || 'FLAVRLY', 'i'));
  const riderPickup = await kds.getByText(/RIDER PICKUP/i).first().isVisible().catch(() => false);
  note(`KDS shows FLAVRLY ${codCode}; "FLAVRLY RIDER PICKUP" label ${riderPickup ? 'present' : 'absent (LEAD-1/NQ-5 not on the Novaryq branch under test)'}`);
  await shot(kds, 'novaryq-kds-flavrly-ticket', `Ticket(s) on the Novaryq KDS a few seconds after checkout: "FLAVRLY ${codCode}", DELIVERY, routed to the tandoor and hot-line stations — no cashier tap. ${riderPickup ? '"FLAVRLY RIDER PICKUP" shown.' : '("FLAVRLY RIDER PICKUP" label pending NQ-5 on the Novaryq branch.)'}`);

  // ── 5. Kitchen bumps every ticket of the order → Novaryq READY → Flavrly READY ──
  // Bump every ticket of this order (one per station): the smallest card around each BUMP button that
  // names the order is the ticket; clicking it is exactly the cook's tap.
  for (let i = 0; i < 8; i++) {
    const clicked = await kds.evaluate((tail) => {
      for (const btn of Array.from(document.querySelectorAll('button'))) {
        if (!/bump/i.test(btn.textContent ?? '')) continue;
        let el: HTMLElement | null = btn.parentElement;
        while (el && !(el.innerText ?? '').includes(tail)) el = el.parentElement;
        if (el && el.querySelectorAll('button').length <= 3) { btn.click(); return true; }
      }
      return false;
    }, codTail);
    if (!clicked) break;
    note(`kitchen bumped a ${codCode} ticket`);
    await kds.waitForTimeout(4_000);
  }
  await shot(kds, 'novaryq-kds-bumped', 'Kitchen bumped the Flavrly ticket(s): Novaryq marks the order READY and emits order.status_changed.');
  await c.goto(`${FL}/orders/${codOrder}`, { waitUntil: 'domcontentloaded' });
  // The tracker always lists the step names; wait for the CURRENT status (the signed READY webhook, or
  // the 10-minute status-poll fallback when a delivery is lost).
  await waitForText(c, /Currently:\s*Ready/i, 20_000, 900_000);
  await shot(c, 'flavrly-order-ready', 'Customer tracker: order READY on Flavrly (Novaryq READY → ACCEPTED → PREPARING → READY through transitionOrder, signed webhook).');

  // ── 6. Flavrly test rider picks up and delivers (rider app API) ──
  const rider = new RiderApp(await playwright.request.newContext());
  await rider.login(E.FL_RIDER_PHONE!);
  await rider.online();
  const claimed = await rider.claim(codOrder);
  const assignmentId: string = claimed.id ?? claimed.assignment?.id;
  await rider.act(assignmentId, 'reach-restaurant').catch(() => undefined);
  await rider.act(assignmentId, 'pickup');
  await c.reload({ waitUntil: 'domcontentloaded' });
  await waitForText(c, /delivery code|Hand this code/i);
  await c.getByText(/Your delivery code|Hand this code/i).first().scrollIntoViewIfNeeded();
  await shot(c, 'flavrly-out-for-delivery', 'Rider picked up at the Novaryq kitchen: OUT_FOR_DELIVERY on Flavrly, and the customer sees the hand-over code.');
  const tracker = await c.locator('main').innerText();
  const otp = (tracker.slice(tracker.search(/Your delivery code|Hand this code/i)).replace(/\s+/g, '').match(/(\d{4,6})/) ?? [])[1];
  note(`customer read out the delivery code (${otp ? otp.length + ' digits' : 'not found'})`);
  await rider.act(assignmentId, 'reach-customer').catch(() => undefined);
  await rider.act(assignmentId, 'deliver', { otp });
  await c.reload({ waitUntil: 'domcontentloaded' });
  await waitForText(c, /Delivered\. Enjoy|Delivered — hope you enjoy/i, 20_000, 600_000);
  await shot(c, 'flavrly-delivered', 'Rider entered the customer\'s code: order DELIVERED on Flavrly (Novaryq keeps the kitchen side; the rider leg is Flavrly\'s).');
  const riderCtx = await context(browser, MOBILE, 'flavrly-rider-portal');
  const r = await riderCtx.newPage();
  await stage('rider-portal', r, async () => {
  await r.goto(`${FL}/rider/login`);
  await dismissCookies(r);
  await r.locator('#rider-phone').fill(E.FL_RIDER_PHONE!.replace(/^\+91/, ''));
  await r.getByRole('button', { name: /Send verification code/ }).click();
  const rcode = (await r.getByText(/code is \d{6}/).innerText()).match(/\d{6}/)![0];
  await r.locator('input[autocomplete="one-time-code"]').first().fill(rcode);
  await r.getByRole('button', { name: /Verify|Sign in|Continue/ }).first().click();
  await r.waitForURL((u) => !u.pathname.startsWith('/rider/login'), { timeout: 600_000 });
  await shot(r, 'flavrly-rider-portal', 'Test rider\'s web portal after the delivery (earnings / shifts).');
  });

  // ── 7. Prepaid order ──
  await stage('prepaid', c, async () => {
  await c.goto(`${FL}/r/${E.FL_RESTAURANT_SLUG ?? 'flavrly-test-kitchen'}`);
  await addToCart(c, 'Hyderabadi Veg Biryani');
  const prepaid = await checkout(c, 'ONLINE');
  await c.goto(`${FL}/orders/${prepaid}`, { waitUntil: 'domcontentloaded' });
  await shot(c, 'flavrly-order-placed-prepaid', 'Prepaid order (local mock gateway auto-confirms the payment) — RECEIVED after capture, then pushed as PREPAID.');
  const preCode = await orderCode(c);
  await waitForText(kds, new RegExp(preCode.split('-').pop() || 'FLAVRLY', 'i'));
  await shot(kds, 'novaryq-kds-prepaid-ticket', `Prepaid Flavrly order ${preCode} on the KDS (external tender recorded, nothing to collect).`);
  });

  // ── 8. 86 on the Novaryq POS → unavailable on Flavrly; un-86 restores ──
  const posCtx = await story86(browser, c);

  // ── 9. Novaryq India: the Flavrly-linked business hands its consumer channel to Flavrly (FNI-3.1) ──
  await stage('consumer-channel', kds, async () => {
  if (E.NQ_CONSUMER_CHANNEL === 'FLAVRLY') {
    await kds.goto(`${NQ_WEB}/admin/integrations`);
    const card = kds.getByText(/Flavrly/).filter({ visible: true }).first();
    if (await card.waitFor({ timeout: 180_000 }).then(() => true, () => false)) {
      await card.scrollIntoViewIfNeeded();
      await shot(kds, 'novaryq-admin-flavrly-card', 'Novaryq India admin → Integrations: the Flavrly card (consumer channel FLAVRLY, last Flavrly order, webhook health, partner key in use).', true);
    } else note('Novaryq admin Integrations page did not show a Flavrly card');
    for (const [size, name] of [[DESKTOP, 'novaryq-storefront-desktop'], [MOBILE, 'novaryq-storefront-mobile']] as const) {
      const sctx = await context(browser, size, name);
      const sp = await sctx.newPage();
      const store = E.NQ_STORE_HOST ?? NQ_BIZ;
      await sp.goto(`${store}/`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      const redirected = await sp.waitForURL((u) => u.origin === new URL(FL).origin, { timeout: 120_000 }).then(() => true, () => false);
      note(`Novaryq storefront ${store}/ ${redirected ? `redirected to ${sp.url()}` : `did NOT redirect (at ${sp.url()})`}`);
      await shot(sp, name, redirected
        ? `The restaurant's Novaryq storefront (${new URL(store).host}/) sends the guest to its Flavrly page: one online channel, one menu of record.`
        : `The restaurant's Novaryq storefront (${new URL(store).host}/) — expected a redirect to Flavrly, got ${sp.url()}.`);
      await sctx.close();
    }
  } else {
    note(`consumer channel not switched (NQ_CONSUMER_CHANNEL=${E.NQ_CONSUMER_CHANNEL ?? 'unset'}): storefront redirect not shown`);
  }
  });

  // ── 10. GST invoice for the channel order (Novaryq receipt API, owner session) ──
  await stage('gst-receipt', null, async () => {
  const api = await playwright.request.newContext();
  const login = await (await api.post(`${E.NQ_API}/v1/auth/login`, { data: { email: E.NQ_OWNER_EMAIL, password: E.NQ_OWNER_PASSWORD } })).json();
  const list = await (await api.get(`${E.NQ_API}/api/v1/orders?externalRef=${codOrder}&source=flavrly`, { headers: await signedHeaders('') })).json().catch(() => null);
  const nqId = list?.data?.[0]?.id;
  if (nqId) {
    const rec = await api.get(`${E.NQ_API}/v1/orders/${nqId}/receipt`, { headers: { authorization: `Bearer ${login.accessToken}` } });
    const body = await rec.text();
    writeFileSync(`${OUT}/novaryq-receipt-${codCode || nqId}.json`, body);
    const inv = await browser.newPage({ viewport: DESKTOP });
    await inv.setContent(`<html><body style="font:14px/1.4 ui-monospace,monospace;padding:24px"><h2>Novaryq receipt API — Flavrly order ${codCode}</h2><p>GET /v1/orders/${nqId}/receipt (HTTP ${rec.status()})</p><pre style="white-space:pre-wrap">${body.replace(/</g, '&lt;').slice(0, 6000)}</pre></body></html>`);
    await shot(inv, 'novaryq-gst-receipt', `Novaryq receipt for the Flavrly channel order (GST invoice data: GSTIN, invoice series, CGST/SGST split) — raw API output, HTTP ${rec.status()}.`, true);
    await inv.close();
  } else {
    note('could not resolve the Novaryq order id for the receipt');
  }
  });

  for (const ctx of [admin, kitchenCtx, custCtx, deskCust, riderCtx, posCtx]) await ctx.close();
  note(failedStages.length ? `story finished with failed stages: ${failedStages.join(', ')}` : 'story finished: every stage completed');
});

/** Partner-API HMAC headers (CONTRACT §1) with the demo key — used only to look up the Novaryq order id. */
async function signedHeaders(body: string) {
  const { createHash, createHmac } = await import('node:crypto');
  const ts = String(Math.floor(Date.now() / 1000));
  const key = createHash('sha256').update(E.NQ_SECRET!).digest('hex');
  return { 'x-api-key': E.NQ_CLIENT_ID!, 'x-timestamp': ts, 'x-signature': createHmac('sha256', key).update(`${ts}.${body}`).digest('hex') };
}
