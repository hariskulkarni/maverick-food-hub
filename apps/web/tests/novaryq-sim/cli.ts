/**
 * Standalone simulator for manual runs against a local Flavrly dev server.
 *
 *   npx tsx tests/novaryq-sim/cli.ts [port=4510]
 *
 * Partner API on :port (configure Flavrly baseUrl = http://127.0.0.1:<port>), control API on :port+1:
 *   GET  /state                                   orders, subscriptions, deliveries
 *   POST /advance {orderId|externalRef, status}   kitchen status change -> webhook
 *   POST /86 {itemCode, available, locationId?}   availability flip -> webhook
 *   POST /fault {route:"POST /api/v1/orders", status?, retryAfterSec?, delayMs?, reset?, phase?, times?}
 *   POST /flush                                   deliver pending webhooks
 * Local only: binds 127.0.0.1.
 */
import { createServer } from 'node:http';
import { NovaryqSimulator, type Fault } from './simulator';

const port = Number(process.argv[2] ?? 4510);
const sim = new NovaryqSimulator();
const key = sim.addKey();
const loc = sim.addLocation('INR', 'Main');
sim.addItem({ name: 'Paneer Tikka', price: '249.00', sku: 'SKU-123', categoryName: 'Starters', modifierGroups: [{ name: 'Add-ons', options: [{ name: 'Extra cheese', price: '30.00' }] }] });
sim.addItem({ name: 'Dal Makhani', price: '180.00', sku: 'SKU-200', categoryName: 'Mains' });
sim.addItem({ name: 'Butter Naan', price: '45.00', shortCode: 'NAAN', categoryName: 'Breads' });

void sim.start(port).then(() => console.log(JSON.stringify({ baseUrl: sim.baseUrl, control: `http://127.0.0.1:${port + 1}`, clientId: key.clientId, secret: key.secret, locationId: loc.id, currency: loc.currency }, null, 2)));
const control = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const b = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const ok = (x: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(x, null, 2));
  try {
    if (req.url === '/state') return ok({ orders: [...sim.orders.values()], subscriptions: [...sim.subscriptions.values()], deliveries: sim.deliveries.map((d) => ({ ...d, body: undefined })) });
    if (req.url === '/advance') {
      const id = b.orderId ?? sim.orderByExternalRef(b.externalRef)?.id;
      sim.advance(id, b.status);
      return ok(await sim.flush());
    }
    if (req.url === '/86') {
      sim.set86(b.itemCode, b.available, b.locationId ?? null);
      return ok(await sim.flush());
    }
    if (req.url === '/fault') {
      const fault: Fault = b.reset ? { kind: 'reset', phase: b.phase } : b.delayMs ? { kind: 'delay', ms: b.delayMs, phase: b.phase } : { kind: 'status', status: b.status, retryAfterSec: b.retryAfterSec, phase: b.phase };
      sim.injectFault(b.route, fault, b.times ?? 1);
      return ok({ injected: b });
    }
    if (req.url === '/flush') return ok(await sim.flush());
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(400).end(String((e as Error).message));
  }
});
control.listen(port + 1, '127.0.0.1');
