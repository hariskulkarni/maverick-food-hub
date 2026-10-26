/**
 * Flavrly worker -> a REAL Novaryq apps/api (local), when NQ_BASE_URL/NQ_CLIENT_ID/NQ_SECRET/
 * NQ_LOCATION_ID/NQ_ITEM_CODE/NQ_ITEM_CODE_2 point at one (seeded tenant, INR location). Verifies what
 * the simulator cannot: that Novaryq records Flavrly's money exactly, fires the order, replays
 * idempotently and voids on a Flavrly cancel. Webhooks back to Flavrly are out of scope here: Novaryq's
 * egress guard (vetWebhookUrl) refuses 127.0.0.1 targets by design.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NovaryqSimulator, toPaise } from '../novaryq-sim/simulator';
import { nqFetch, type NqCreds } from '../novaryq-sim/client';
import { fl } from './fl';
import { db, fastForward, makeShop, placeCod, placePrepaid, capturePrepaid, prisma, saveCfg, syncOf, transitionOrder, type Shop } from './harness';

const env = process.env;
const REAL = !!env.NQ_BASE_URL;
let shop: Shop;
let creds: NqCreds;
const money = (d: unknown) => Number(d).toFixed(2);

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
    shop = await makeShop(placeholder);
    await saveCfg(shop, { baseUrl: creds.baseUrl, clientId: creds.clientId, secret: creds.secret });
    await db.novaryqLocationLink.update({ where: { branchId: shop.branchId }, data: { novaryqLocationId: env.NQ_LOCATION_ID! } });
    await db.novaryqItemLink.update({ where: { menuItemId: shop.paneer.id }, data: { novaryqItemCode: env.NQ_ITEM_CODE! } });
    await db.novaryqItemLink.update({ where: { menuItemId: shop.dal.id }, data: { novaryqItemCode: env.NQ_ITEM_CODE_2! } });
  });
  afterAll(async () => {
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
});
