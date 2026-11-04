/**
 * Flavrly worker -> a REAL Novaryq apps/api (local), when NQ_BASE_URL/NQ_CLIENT_ID/NQ_SECRET/
 * NQ_LOCATION_ID/NQ_ITEM_CODE/NQ_ITEM_CODE_2 point at one (seeded tenant, INR location). Verifies what
 * the simulator cannot: that Novaryq records Flavrly's money exactly, fires the order, replays
 * idempotently, voids on a Flavrly cancel, and answers the poll fallback.
 *
 * Webhook leg (FNI): with NQ_WEBHOOK_SECRET + FL_HOOK_PORT set, this file listens on
 * http://127.0.0.1:$FL_HOOK_PORT and hands every POST to the real Flavrly webhook route handler. The
 * Novaryq subscription (events order.status_changed + menu.item.availability_changed) must point at
 * http://127.0.0.1:$FL_HOOK_PORT/api/integrations/novaryq/webhook/$FL_E2E_RESTAURANT_ID (default
 * fni-e2e-kitchen) and Novaryq must allow loopback webhook targets in its dev/test mode. The 86 test needs
 * the key's write:menu scope. Optional refusals: NQ_NA_CLIENT_ID/NQ_NA_SECRET (a North-American tenant's
 * key), NQ_FOREIGN_LOCATION_ID (another tenant's location) and NQ_STAFF_EMAIL/NQ_STAFF_PASSWORD (a staff
 * login of the tenant, to bump the KDS ticket in Novaryq itself).
 */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NovaryqSimulator, toPaise } from '../novaryq-sim/simulator';
import { nqFetch, type NqCreds } from '../novaryq-sim/client';
import { fl } from './fl';
import { db, fastForward, makeShop, placeCod, placePrepaid, capturePrepaid, prisma, saveCfg, statusOf, syncOf, transitionOrder, type Shop } from './harness';
import { checkLocationCurrency, testNovaryqConnection } from '@/server/novaryq/menu';
import { pollStaleOrderStatuses } from '@/server/novaryq/status';
import { saveNovaryqCredentials, setBranchLocation } from '@/server/novaryq/admin';

const env = process.env;
const REAL = !!env.NQ_BASE_URL;
const HOOKS = REAL && !!env.NQ_WEBHOOK_SECRET && !!env.FL_HOOK_PORT;
const HOOK_RESTAURANT_ID = env.FL_E2E_RESTAURANT_ID || 'fni-e2e-kitchen';
let shop: Shop;
let creds: NqCreds;
let receiver: http.Server | null = null;
const received: Array<{ event: string | null; status: number }> = [];
const money = (d: unknown) => Number(d).toFixed(2);

/** Polls `ok` (running the Flavrly worker between tries) until true or 30 s pass. */
async function until(ok: () => Promise<boolean>, what: string) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (await ok()) return;
    await fl.runWorker();
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}; webhooks received: ${JSON.stringify(received)}`);
}

/** Real HTTP in, real route handler: what next start does for this path (minus middleware, which only exempts it from CSRF). */
function startReceiver(port: number) {
  receiver = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const m = req.url?.match(/^\/api\/integrations\/novaryq\/webhook\/([^/?]+)$/);
    if (req.method !== 'POST' || !m) return void res.writeHead(404).end();
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const out = await fl.webhookPOST(new Request(`http://127.0.0.1:${port}${req.url}`, { method: 'POST', headers, body: Buffer.concat(chunks) }), m[1]!);
    received.push({ event: headers.get('x-novaryq-event'), status: out.status });
    res.writeHead(out.status).end(await out.text());
  });
  return new Promise<void>((r) => receiver!.listen(port, '127.0.0.1', r));
}

async function nqOrder(orderId: string) {
  const list = await nqFetch(creds, 'GET', `/api/v1/orders?externalRef=${orderId}&source=flavrly`);
  expect(list.status).toBe(200);
  expect(list.json.total).toBe(1);
  const one = await nqFetch(creds, 'GET', `/api/v1/orders/${list.json.data[0].id}`);
  expect(one.status).toBe(200);
  return one.json;
}

describe.runIf(REAL)('Flavrly -> real Novaryq API', () => {
  beforeAll(async () => {
    creds = { baseUrl: env.NQ_BASE_URL!, clientId: env.NQ_CLIENT_ID!, secret: env.NQ_SECRET! };
    // Build a Flavrly shop wired to the real API instead of the simulator.
    const placeholder = new NovaryqSimulator();
    shop = await makeShop(placeholder, HOOKS ? { restaurantId: HOOK_RESTAURANT_ID } : {});
    await saveCfg(shop, { baseUrl: creds.baseUrl, clientId: creds.clientId, secret: creds.secret, ...(HOOKS ? { webhookSecret: env.NQ_WEBHOOK_SECRET! } : {}) });
    if (HOOKS) await startReceiver(Number(env.FL_HOOK_PORT));
    await db.novaryqLocationLink.update({ where: { branchId: shop.branchId }, data: { novaryqLocationId: env.NQ_LOCATION_ID! } });
    await db.novaryqItemLink.update({ where: { menuItemId: shop.paneer.id }, data: { novaryqItemCode: env.NQ_ITEM_CODE! } });
    await db.novaryqItemLink.update({ where: { menuItemId: shop.dal.id }, data: { novaryqItemCode: env.NQ_ITEM_CODE_2! } });
  });
  afterAll(async () => {
    await new Promise((r) => (receiver ? receiver.close(r) : r(null)));
    await prisma.$disconnect();
  });

  it('COD push: Novaryq records Flavrly totals to the paisa, UNPAID, fired to the kitchen, numbered', async () => {
    await prisma.wallet.upsert({ where: { userId: shop.customerId }, update: { balance: 50 as any }, create: { userId: shop.customerId, balance: 50 as any } });
    const order = await placeCod(shop, undefined, { walletApply: 50 });
    await fl.runWorker();
    const sync = await syncOf(order.id);
    expect(sync.state).toBe('SENT');
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const nq = await nqOrder(order.id);
    expect(sync.novaryqOrderId).toBe(nq.id);
    expect(nq.source).toBe('flavrly');
    expect(nq.externalRef).toBe(order.id);
    expect(nq.externalCode).toBe(o.code.slice(0, 32));
    expect(['SENT', 'IN_PREP']).toContain(nq.status);
    expect(money(nq.grandTotal)).toBe(money(o.total));
    expect(money(nq.subtotal)).toBe(money(o.subtotal));
    const lineSum = (nq.lines as any[]).reduce((s, l) => s + toPaise(money(l.lineTotal)), 0);
    expect(lineSum).toBe(toPaise(money(o.subtotal)));
    if (nq.channelPaymentStatus !== undefined) expect(nq.channelPaymentStatus).toBe('UNPAID');
  });

  it('prepaid push records PREPAID; a replayed push returns the same Novaryq order', async () => {
    const order = await placePrepaid(shop);
    await capturePrepaid(order.id);
    await fl.runWorker();
    const first = await syncOf(order.id);
    expect(first.state).toBe('SENT');
    const nq = await nqOrder(order.id);
    if (nq.channelPaymentStatus !== undefined) expect(nq.channelPaymentStatus).toBe('PREPAID');
    // Force a second push of the same order (as after a lost response): Novaryq must answer the same order.
    await db.novaryqOrderSync.update({ where: { orderId: order.id }, data: { state: 'PENDING', novaryqOrderId: null } });
    await fastForward();
    await fl.runWorker();
    const again = await syncOf(order.id);
    expect(again.state).toBe('SENT');
    expect(again.novaryqOrderId).toBe(first.novaryqOrderId);
    expect((await nqFetch(creds, 'GET', `/api/v1/orders?externalRef=${order.id}&source=flavrly`)).json.total).toBe(1);
  });

  it('Flavrly cancel voids the Novaryq order', async () => {
    const order = await placeCod(shop);
    await fl.runWorker();
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER' as any);
    await fl.runWorker();
    expect((await syncOf(order.id)).state).toBe('CANCELLED');
    expect((await nqOrder(order.id)).status).toBe('VOIDED');
  });

  it('menu import from the real GET /menu links items and keeps prices', async () => {
    const s2 = await makeShop(new NovaryqSimulator());
    await saveCfg(s2, { baseUrl: creds.baseUrl, clientId: creds.clientId, secret: creds.secret });
    await db.novaryqLocationLink.update({ where: { branchId: s2.branchId }, data: { novaryqLocationId: env.NQ_LOCATION_ID! } });
    await db.novaryqItemLink.deleteMany({ where: { restaurantId: s2.restaurantId } });
    await fl.importMenu(s2.restaurantId, s2.branchId, s2.ownerId);
    const link = await db.novaryqItemLink.findFirst({ where: { restaurantId: s2.restaurantId, novaryqItemCode: env.NQ_ITEM_CODE! }, include: { menuItem: true } });
    expect(link).toBeTruthy();
    const menu = await nqFetch(creds, 'GET', `/api/v1/menu?locationId=${env.NQ_LOCATION_ID}`);
    const src = menu.json.data.find((i: any) => i.itemCode === env.NQ_ITEM_CODE);
    expect(money(link.menuItem.price)).toBe(money(src.price));
  });

  it('admin setup path: test-and-save against the real API, then link the branch (INR checked)', async () => {
    const s3 = await makeShop(new NovaryqSimulator());
    await db.integrationCredential.deleteMany({ where: { restaurantId: s3.restaurantId } });
    const ctx = { restaurantId: s3.restaurantId, restaurantName: 'FNI admin path', userId: s3.ownerId };
    const saved = await saveNovaryqCredentials(ctx, { baseUrl: creds.baseUrl, clientId: creds.clientId, secret: creds.secret, webhookSecret: 'whsec_fni_admin_path', enabled: true });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
    const linked = await setBranchLocation(ctx, s3.branchId, env.NQ_LOCATION_ID!);
    expect(linked, JSON.stringify(linked)).toMatchObject({ ok: true });
    expect((linked as { itemCount: number }).itemCount).toBeGreaterThan(0);
  });

  it('F-07: a pickup handed over on Flavrly is closed in Novaryq (POST /complete, API 1.5.2), COD balance and all', async () => {
    const pick = await placeCod(shop, undefined, { fulfillmentType: 'PICKUP', addressId: null });
    await fl.runWorker();
    expect((await syncOf(pick.id)).state).toBe('SENT');
    for (const st of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED']) await transitionOrder(pick.id, st as any);
    await fl.runWorker();
    const sync = await syncOf(pick.id);
    expect(sync, JSON.stringify(sync)).toMatchObject({ state: 'COMPLETED', lastError: null });
    expect((await nqOrder(pick.id)).status).toBe('COMPLETED');
  });

  it('poll fallback: a pushed order whose webhooks never came reads its status from GET /orders/:id', async () => {
    await db.restaurant.update({ where: { id: shop.restaurantId }, data: { autoAcceptOrders: true } });
    try {
      const order = await placeCod(shop);
      await fl.runWorker();
      expect((await syncOf(order.id)).state).toBe('SENT');
      // As if every status webhook was lost: nothing recorded, quiet for more than 10 minutes.
      await prisma.$executeRaw`UPDATE "NovaryqOrderSync" SET "lastStatus" = NULL, "lastStatusAt" = NULL, "updatedAt" = now() - interval '11 minutes' WHERE "orderId" = ${order.id}`;
      const r = await pollStaleOrderStatuses(shop.restaurantId);
      expect(r.errors).toBe(0);
      expect(r.polled).toBeGreaterThanOrEqual(1);
      expect(['SENT', 'IN_PREP', 'READY']).toContain((await syncOf(order.id)).lastStatus);
      expect(['ACCEPTED', 'PREPARING', 'READY']).toContain((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status);
    } finally {
      await db.restaurant.update({ where: { id: shop.restaurantId }, data: { autoAcceptOrders: false } });
    }
  });

  it('refusals: a wrong secret fails the connection test (401)', async () => {
    const r = await testNovaryqConnection({ ...creds, secret: 'nqsec_wrong' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it.runIf(!!env.NQ_NA_CLIENT_ID)('refusals: a North-American tenant key is refused (not INR)', async () => {
    const r = await testNovaryqConnection({ baseUrl: creds.baseUrl, clientId: env.NQ_NA_CLIENT_ID!, secret: env.NQ_NA_SECRET! });
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/Novaryq India|INR/);
  });

  it.runIf(!!env.NQ_FOREIGN_LOCATION_ID)('refusals: another tenant\'s location cannot be linked with this key', async () => {
    expect((await checkLocationCurrency(creds, env.NQ_FOREIGN_LOCATION_ID!)).ok).toBe(false);
  });

  it.runIf(HOOKS)('webhook: an 86 in Novaryq reaches Flavrly over HTTP within seconds, and so does the restore', async () => {
    const patch = (available: boolean) => nqFetch(creds, 'PATCH', `/api/v1/menu/items/${encodeURIComponent(env.NQ_ITEM_CODE_2!)}/availability`, { available });
    const avail = async () => (await prisma.menuItem.findUniqueOrThrow({ where: { id: shop.dal.id } })).isAvailable;
    try {
      const off = await patch(false);
      expect(off.status, JSON.stringify(off.json)).toBe(200);
      await until(async () => !(await avail()), 'the 86 on Flavrly');
      expect((await patch(true)).status).toBe(200);
      await until(avail, 'the restore on Flavrly');
      expect(received.filter((d) => d.event?.startsWith('menu.item.')).every((d) => d.status === 200)).toBe(true);
    } finally {
      await patch(true);
    }
  });

  it.runIf(HOOKS && !!env.NQ_STAFF_EMAIL)('webhook: a Novaryq KDS bump (READY) reaches Flavrly', async () => {
    const order = await placeCod(shop);
    await fl.runWorker();
    const sync = await syncOf(order.id);
    expect(sync.state).toBe('SENT');
    const login = await fetch(`${creds.baseUrl}/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: env.NQ_STAFF_EMAIL, password: env.NQ_STAFF_PASSWORD }),
    });
    const { accessToken } = await login.json();
    expect(accessToken, `staff login ${login.status}`).toBeTruthy();
    const authz = { authorization: `Bearer ${accessToken}` };
    let mine: Array<{ id: string }> = [];
    await until(async () => {
      const list = await (await fetch(`${creds.baseUrl}/v1/kds/tickets?locationId=${encodeURIComponent(env.NQ_LOCATION_ID!)}`, { headers: authz })).json();
      mine = ((list?.data ?? list ?? []) as Array<{ id: string; orderId: string }>).filter((t) => t.orderId === sync.novaryqOrderId);
      return mine.length > 0;
    }, 'the KDS ticket of the Flavrly order');
    for (const t of mine) {
      const bump = await fetch(`${creds.baseUrl}/v1/kds/tickets/${t.id}/bump`, { method: 'POST', headers: authz });
      expect(bump.ok, `bump ${bump.status}`).toBe(true);
    }
    await until(async () => (await statusOf(order.id)) === 'READY' && (await syncOf(order.id)).lastStatus === 'READY', 'READY on Flavrly');
  });

  it.runIf(HOOKS)('webhook: order.status_changed reaches Flavrly signed and is applied (VOIDED after a Flavrly cancel)', async () => {
    const order = await placeCod(shop);
    await fl.runWorker();
    const sent = await syncOf(order.id);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER' as any);
    await fl.runWorker();
    await until(async () => (await syncOf(order.id)).lastStatus === 'VOIDED', 'order.status_changed VOIDED');
    const events = await db.novaryqWebhookEvent.findMany({ where: { restaurantId: shop.restaurantId, event: 'order.status_changed' } });
    const mine = events.filter((e: any) => JSON.stringify(e.payload).includes(sent.novaryqOrderId));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.every((e: any) => e.processedAt && !e.error)).toBe(true);
    expect(received.filter((d) => d.event === 'order.status_changed').every((d) => d.status === 200)).toBe(true);
  });
});
