/**
 * E2E §5 Menu: import from Novaryq, 86 / un-86 availability events, per-location scope, reconcile.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NovaryqSimulator } from '../novaryq-sim/simulator';
import { fl } from './fl';
import { db, makeShop, placeCod, prisma, routeTransport, type Shop } from './harness';

let sim: NovaryqSimulator;
let shop: Shop;
const available = async (menuItemId: string) => (await prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } })).isAvailable;

async function flip(code: string, isAvailable: boolean, locationId: string | null, occurredAt?: string) {
  sim.set86(code, isAvailable, locationId, occurredAt);
  await sim.flush();
  await fl.runWorker();
}

beforeAll(async () => {
  sim = new NovaryqSimulator({ transport: routeTransport });
  await sim.start();
  shop = await makeShop(sim);
});
afterAll(async () => {
  await sim.stop();
  await prisma.$disconnect();
});

describe('menu import', () => {
  it('creates categories + items + links from GET /menu, keeps prices, honours 86 state, and is idempotent', async () => {
    const s = await makeShop(sim);
    const jamun = sim.addItem({ name: 'Gulab Jamun', price: '120.00', sku: `SKU-G-${s.branchId.slice(-6)}`, categoryName: 'Desserts' });
    const soldOut = sim.addItem({ name: 'Kulfi', price: '75.50', shortCode: `KUL${s.branchId.slice(-4)}`, categoryName: 'Desserts', available: false });
    await fl.importMenu(s.restaurantId, s.branchId, s.ownerId);
    const link = (code: string) => db.novaryqItemLink.findFirst({ where: { restaurantId: s.restaurantId, novaryqItemCode: code }, include: { menuItem: { include: { category: true } } } });
    const j = await link(NovaryqSimulator.itemCode(jamun));
    expect(j?.menuItem).toMatchObject({ name: 'Gulab Jamun', branchId: s.branchId, isAvailable: true });
    expect(Number(j!.menuItem.price)).toBe(120);
    expect(j!.menuItem.category.name).toBe('Desserts');
    const k = await link(NovaryqSimulator.itemCode(soldOut));
    expect(Number(k!.menuItem.price)).toBe(75.5);
    expect(k!.menuItem.isAvailable).toBe(false);
    // Existing linked items are updated, not duplicated.
    const countBefore = await prisma.menuItem.count({ where: { branchId: s.branchId } });
    await fl.importMenu(s.restaurantId, s.branchId, s.ownerId);
    expect(await prisma.menuItem.count({ where: { branchId: s.branchId } })).toBe(countBefore);
    expect(await prisma.category.count({ where: { branchId: s.branchId, name: 'Desserts' } })).toBe(1);
  });

  it('import is tenant-scoped: it never touches another restaurant’s items', async () => {
    const a = await makeShop(sim);
    const b = await makeShop(sim);
    const bItemsBefore = await prisma.menuItem.findMany({ where: { branchId: b.branchId }, orderBy: { id: 'asc' } });
    await fl.importMenu(a.restaurantId, a.branchId, a.ownerId);
    expect(await prisma.menuItem.findMany({ where: { branchId: b.branchId }, orderBy: { id: 'asc' } })).toEqual(bItemsBefore);
  });
});

describe('availability (86 / un-86)', () => {
  it('86 in Novaryq marks the linked Flavrly item unavailable; un-86 restores it', async () => {
    await flip(shop.paneer.code, false, null);
    expect(await available(shop.paneer.id)).toBe(false);
    await expect(placeCod(shop, [{ menuItemId: shop.paneer.id, quantity: 1 }])).rejects.toThrow(/not available/i);
    await flip(shop.paneer.code, true, null);
    expect(await available(shop.paneer.id)).toBe(true);
  });

  it('a location-scoped 86 only affects the branch linked to that location', async () => {
    const other = sim.addLocation('INR', 'Elsewhere');
    await flip(shop.dal.code, false, other.id);
    expect(await available(shop.dal.id)).toBe(true);
    await flip(shop.dal.code, false, shop.location.id);
    expect(await available(shop.dal.id)).toBe(false);
    await flip(shop.dal.code, true, shop.location.id);
    expect(await available(shop.dal.id)).toBe(true);
  });

  it('out-of-order availability events: the newest occurredAt wins', async () => {
    sim.hold = true;
    sim.set86(shop.paneer.code, false, null, new Date(Date.now() - 10_000).toISOString());
    sim.set86(shop.paneer.code, true, null, new Date().toISOString());
    await sim.releaseHeld('reverse');
    await fl.runWorker();
    expect(await available(shop.paneer.id)).toBe(true);
  });

  it('an event for an unknown item code is accepted and ignored', async () => {
    const ghost = sim.addItem({ name: 'Ghost', price: '1.00', sku: `GHOST-${Date.now()}` });
    const [d] = sim.set86(NovaryqSimulator.itemCode(ghost), false, null);
    await sim.flush();
    expect(d!.attempts[0]!.status).toBe(200);
    await fl.runWorker();
    const row = await db.novaryqWebhookEvent.findUnique({ where: { deliveryId: d!.id } });
    expect(row.processedAt).not.toBeNull();
  });

  it('a missed webhook is repaired by the reconcile job (GET /menu)', async () => {
    shop.sub.isActive = false; // Novaryq auto-disabled the subscription; the 86 is never delivered
    sim.set86(shop.paneer.code, false, null);
    await sim.flush();
    expect(await available(shop.paneer.id)).toBe(true);
    shop.sub.isActive = true;
    await fl.reconcile(shop.restaurantId);
    expect(await available(shop.paneer.id)).toBe(false);
    await flip(shop.paneer.code, true, null);
  });
});
