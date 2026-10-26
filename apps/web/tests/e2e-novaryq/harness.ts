/**
 * E2E harness: real Flavrly server code against a disposable ci_* Postgres + the Novaryq simulator.
 *
 * Only these are not production code: notification/realtime side effects (mocked by the test
 * files), wall-clock waits (we fast-forward `nextAttemptAt` in the DB instead of sleeping), and
 * the webhook transport (simulator deliveries are handed straight to the Next route handler).
 *
 * Everything Flavrly-side that the contract does not pin by name (worker entry point, menu import,
 * replay, …) is resolved in fl.ts, so a rename in FL's branch is a one-line change there.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db';
import { saveConfig } from '@/server/integrations';
import { placeOrder, transitionOrder } from '@/server/orders';
import { NovaryqSimulator, type SimApiKey, type SimItem, type SimLocation, type SimSubscription, type WebhookTransport } from '../novaryq-sim/simulator';
import { fl } from './fl';

export const uid = () => randomUUID().replace(/-/g, '').slice(0, 12);
export const WEBHOOK_EVENTS = ['order.status_changed', 'menu.item.availability_changed'];
export const webhookPath = (restaurantId: string) => `/api/integrations/novaryq/webhook/${restaurantId}`;

/** Route simulator deliveries into the real webhook route handler (no network, same bytes). */
export const routeTransport: WebhookTransport = async (url, init) => {
  const u = new URL(url);
  const m = u.pathname.match(/^\/api\/integrations\/novaryq\/webhook\/([^/]+)$/);
  if (!m) return 404;
  const res = await fl.webhookPOST(new Request(url, { method: 'POST', headers: init.headers, body: init.body }), m[1]!);
  await quiesceDelivery(init.headers['x-novaryq-idempotency-key'] ?? init.headers['x-novaryq-delivery']);
  return res.status;
};

/**
 * FL processes a stored delivery inline, fire-and-forget, after answering 200. Wait until that
 * delivery's row is processed or has recorded an error, so assertions never race the inline path.
 * Returns at once when nothing was stored (rejected delivery).
 */
export async function quiesceDelivery(delivery: string | undefined, maxMs = 3_000) {
  if (!delivery) return;
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const row = await eventByDelivery(delivery);
    if (!row || row.processedAt || row.error) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

export interface Shop {
  restaurantId: string;
  branchId: string;
  customerId: string;
  addressId: string;
  ownerId: string;
  location: SimLocation;
  key: SimApiKey;
  sub: SimSubscription;
  webhookSecret: string;
  config: Record<string, string>;
  /** Flavrly menu items linked to Novaryq codes. */
  paneer: { id: string; code: string; sim: SimItem; modifierOptionId: string };
  dal: { id: string; code: string; sim: SimItem };
  /** Flavrly item with NO NovaryqItemLink. */
  unmapped: { id: string; name: string };
}

export interface ShopOpts {
  enabled?: boolean;
  currency?: string;
  taxRatePct?: number;
  packagingFee?: number;
  autoAccept?: boolean;
}

export async function makeShop(sim: NovaryqSimulator, o: ShopOpts = {}): Promise<Shop> {
  const id = uid();
  const owner = await prisma.user.create({ data: { role: 'ADMIN', email: `nq-o-${id}@test.invalid` } });
  const customer = await prisma.user.create({ data: { role: 'CUSTOMER', email: `nq-c-${id}@test.invalid`, name: 'Asha', phone: `+9198${id.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}` } });
  const address = await prisma.address.create({ data: { userId: customer.id, line1: '12 MG Road', city: 'Pune', postalCode: '411001' } });
  const r = await prisma.restaurant.create({ data: { slug: `nq-${id}`, name: `NQ ${id}`, ownerUserId: owner.id, autoAcceptOrders: o.autoAccept ?? false } });
  const b = await prisma.branch.create({
    data: { restaurantId: r.id, name: 'Main', slug: `nqb-${id}`, line1: 'x', city: 'Pune', postalCode: '411001', taxRatePct: o.taxRatePct ?? 5, packagingFee: (o.packagingFee ?? 10) as any },
  });
  const cat = await prisma.category.create({ data: { branchId: b.id, name: 'Mains', slug: `mains-${id}` } });
  const paneer = await prisma.menuItem.create({ data: { branchId: b.id, categoryId: cat.id, name: 'Paneer Tikka', slug: `paneer-${id}`, price: '249.00' as any } });
  const group = await prisma.modifierGroup.create({ data: { menuItemId: paneer.id, name: 'Add-ons', minSelect: 0, maxSelect: 2 } });
  const opt = await prisma.modifierOption.create({ data: { modifierGroupId: group.id, name: 'Extra cheese', priceDelta: '30.00' as any } });
  const dal = await prisma.menuItem.create({ data: { branchId: b.id, categoryId: cat.id, name: 'Dal Makhani', slug: `dal-${id}`, price: '180.50' as any } });
  const lassi = await prisma.menuItem.create({ data: { branchId: b.id, categoryId: cat.id, name: 'Mango Lassi', slug: `lassi-${id}`, price: '99.00' as any } });

  const location = sim.addLocation(o.currency ?? 'INR', `Loc ${id}`);
  const key = sim.addKey();
  const simPaneer = sim.addItem({ name: 'Paneer Tikka', price: '249.00', sku: `SKU-P-${id}`, categoryName: 'Mains', modifierGroups: [{ name: 'Add-ons', options: [{ name: 'Extra cheese', price: '30.00' }] }] });
  const simDal = sim.addItem({ name: 'Dal Makhani', price: '180.50', sku: `SKU-D-${id}`, categoryName: 'Mains' });

  const webhookSecret = `whsec_${uid()}${uid()}`;
  const sub = sim.addSubscription(`http://flavrly.test${webhookPath(r.id)}`, WEBHOOK_EVENTS, webhookSecret);
  const config = {
    baseUrl: sim.baseUrl,
    clientId: key.clientId,
    secret: key.secret,
    webhookSecret,
    enabled: String(o.enabled ?? true),
    pushOn: 'RECEIVED',
  };
  await saveConfig(r.id, 'NOVARYQ' as any, config);
  const db = prisma as any;
  await db.novaryqLocationLink.create({ data: { restaurantId: r.id, branchId: b.id, novaryqLocationId: location.id, currency: location.currency } });
  await db.novaryqItemLink.create({ data: { restaurantId: r.id, menuItemId: paneer.id, novaryqItemCode: NovaryqSimulator.itemCode(simPaneer) } });
  await db.novaryqItemLink.create({ data: { restaurantId: r.id, menuItemId: dal.id, novaryqItemCode: NovaryqSimulator.itemCode(simDal) } });

  return {
    restaurantId: r.id,
    branchId: b.id,
    customerId: customer.id,
    addressId: address.id,
    ownerId: owner.id,
    location,
    key,
    sub,
    webhookSecret,
    config,
    paneer: { id: paneer.id, code: NovaryqSimulator.itemCode(simPaneer), sim: simPaneer, modifierOptionId: opt.id },
    dal: { id: dal.id, code: NovaryqSimulator.itemCode(simDal), sim: simDal },
    unmapped: { id: lassi.id, name: lassi.name },
  };
}

/** Re-save the NOVARYQ credentials with overrides (what the admin settings form does). */
export async function saveCfg(s: Shop, over: Record<string, string>) {
  s.config = { ...s.config, ...over };
  await saveConfig(s.restaurantId, 'NOVARYQ' as any, s.config);
}

type Line = { menuItemId: string; quantity: number; selectedModifierOptionIds?: string[] };

export const standardLines = (s: Shop): Line[] => [
  { menuItemId: s.paneer.id, quantity: 2, selectedModifierOptionIds: [s.paneer.modifierOptionId] },
  { menuItemId: s.dal.id, quantity: 1 },
];

/** COD order: placeOrder creates it straight into RECEIVED. */
export async function placeCod(s: Shop, lines: Line[] = standardLines(s), extra: Record<string, unknown> = {}) {
  const { order } = await placeOrder({
    branchId: s.branchId,
    customerId: s.customerId,
    addressId: s.addressId,
    items: lines,
    paymentMethod: 'COD' as any,
    fulfillmentType: 'DELIVERY' as any,
    customerNotes: 'ring the bell',
    ...extra,
  } as any);
  return order;
}

/** Prepaid order: placed as RAZORPAY (PAYMENT_PENDING), then a server-verified capture releases it. */
export async function placePrepaid(s: Shop, lines: Line[] = standardLines(s)) {
  const { order } = await placeOrder({
    branchId: s.branchId,
    customerId: s.customerId,
    addressId: s.addressId,
    items: lines,
    paymentMethod: 'RAZORPAY' as any,
    fulfillmentType: 'DELIVERY' as any,
  } as any);
  return order;
}

export async function capturePrepaid(orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await prisma.payment.create({ data: { orderId, method: 'RAZORPAY', amount: o.total, providerName: 'razorpay', providerRef: `order_${uid()}`, status: 'CAPTURED' } as any });
  const { releaseOrderAfterCapture } = await import('@/server/payments/reconcile');
  await releaseOrderAfterCapture(orderId, 'test capture');
}

export const db = prisma as any;
export const syncOf = (orderId: string) => db.novaryqOrderSync.findUnique({ where: { orderId } });
export const statusOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;
export const statusTrail = async (orderId: string) =>
  (await prisma.orderStatusEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' }, select: { status: true } })).map((e) => e.status);

/**
 * Stored inbox rows for a Novaryq delivery id. The contract fixes `deliveryId @unique` but not its
 * encoding; FL may namespace it (e.g. `${restaurantId}:${id}`), so match the id as a suffix too.
 */
const byDelivery = (id: string) => ({ OR: [{ deliveryId: id }, { deliveryId: { endsWith: `:${id}` } }] });
export const eventByDelivery = (id: string) => db.novaryqWebhookEvent.findFirst({ where: byDelivery(id) });
export const eventCount = (id: string) => db.novaryqWebhookEvent.count({ where: byDelivery(id) });

/** Make every pending Novaryq row due now (time travel instead of sleeping through backoff). */
export async function fastForward() {
  const past = new Date(Date.now() - 1000);
  await db.novaryqOrderSync.updateMany({ where: { state: { in: ['PENDING', 'CANCEL_PENDING'] } }, data: { nextAttemptAt: past, leaseExpiresAt: null, leaseOwner: null } });
  await db.novaryqWebhookEvent.updateMany({ where: { processedAt: null }, data: { nextAttemptAt: past } });
}

/** Deliver all simulator webhooks, then run the worker, until nothing changes. */
export async function settle(sim: NovaryqSimulator, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await fl.runWorker();
    await sim.flush();
    await fl.runWorker();
  }
}

export { transitionOrder, prisma };
