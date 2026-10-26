/**
 * E2E adversarial: webhook forgery / replay / oversize, tenant isolation, worker-route auth,
 * CSRF + rate-limit allowlist, SSRF on baseUrl, secrets never logged.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NovaryqSimulator } from '../novaryq-sim/simulator';
import { signWebhook } from '../novaryq-sim/signing';
import { fl } from './fl';
import { db, makeShop, placeCod, prisma, routeTransport, saveCfg, statusOf, statusTrail, webhookPath, type Shop } from './harness';

let sim: NovaryqSimulator;
let a: Shop;
let b: Shop;

const statusBody = (s: Shop, over: Record<string, unknown> = {}) =>
  JSON.stringify(sim.envelope('order.status_changed', {
    orderId: 'ord_x', orderNumber: 1, locationId: s.location.id, source: 'flavrly', externalRef: 'none', externalCode: 'X',
    status: 'IN_PREP', previousStatus: 'SENT', occurredAt: new Date().toISOString(), ...over,
  }));

function post(s: Shop | string, body: string, headers: Record<string, string>) {
  const rid = typeof s === 'string' ? s : s.restaurantId;
  return fl.webhookPOST(new Request(`http://flavrly.test${webhookPath(rid)}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }), rid);
}

function signed(secret: string, body: string, o: { t?: number; delivery?: string } = {}) {
  const t = o.t ?? Math.floor(Date.now() / 1000);
  const delivery = o.delivery ?? `dlv_qa_${Math.random().toString(36).slice(2)}`;
  return {
    'x-novaryq-signature': signWebhook(secret, body, t),
    'x-novaryq-timestamp': String(t),
    'x-novaryq-event': 'order.status_changed',
    'x-novaryq-delivery': delivery,
    'x-novaryq-idempotency-key': delivery,
    'x-novaryq-attempt': '1',
    'x-novaryq-max-attempts': '8',
  };
}

const stored = (delivery: string) => db.novaryqWebhookEvent.count({ where: { deliveryId: delivery } });

beforeAll(async () => {
  sim = new NovaryqSimulator({ transport: routeTransport });
  await sim.start();
  a = await makeShop(sim);
  b = await makeShop(sim);
});
afterAll(async () => {
  await sim.stop();
  await prisma.$disconnect();
});

describe('webhook authenticity', () => {
  it('accepts a correctly signed delivery (control)', async () => {
    const body = statusBody(a);
    const h = signed(a.webhookSecret, body);
    expect((await post(a, body, h)).status).toBe(200);
    expect(await stored(h['x-novaryq-delivery'])).toBe(1);
  });

  it.each([
    ['wrong secret', (body: string) => signed('whsec_attacker', body)],
    ['missing signature', (body: string) => { const h: Record<string, string> = signed('x', body); delete h['x-novaryq-signature']; return h; }],
    ['malformed signature', (body: string) => ({ ...signed('x', body), 'x-novaryq-signature': 'v1=deadbeef' })],
    ['sha256(secret) used as key (request-signing scheme)', (body: string) => signed(createHash('sha256').update(a.webhookSecret).digest('hex'), body)],
  ])('rejects %s with 401 and stores nothing', async (_n, mk) => {
    const body = statusBody(a);
    const h = mk(body);
    const res = await post(a, body, h);
    expect(res.status).toBe(401);
    expect(await stored(h['x-novaryq-delivery'] ?? 'none')).toBe(0);
  });

  it('rejects a body tampered after signing', async () => {
    const body = statusBody(a);
    const h = signed(a.webhookSecret, body);
    const res = await post(a, body.replace('IN_PREP', 'VOIDED'), h);
    expect(res.status).toBe(401);
    expect(await stored(h['x-novaryq-delivery'])).toBe(0);
  });

  it('rejects timestamps outside the 5-minute window (past and future), even with a valid HMAC', async () => {
    const body = statusBody(a);
    const now = Math.floor(Date.now() / 1000);
    for (const t of [now - 301, now + 301]) {
      const h = signed(a.webhookSecret, body, { t });
      expect((await post(a, body, h)).status).toBe(401);
      expect(await stored(h['x-novaryq-delivery'])).toBe(0);
    }
    const ok = signed(a.webhookSecret, body, { t: now - 290 });
    expect((await post(a, body, ok)).status).toBe(200);
  });

  it('an exact-byte replay of a captured delivery is deduped inside the window and rejected after it', async () => {
    const body = statusBody(a);
    const h = signed(a.webhookSecret, body);
    expect((await post(a, body, h)).status).toBe(200);
    expect((await post(a, body, h)).status).toBe(200);
    expect(await stored(h['x-novaryq-delivery'])).toBe(1);
    const old = signed(a.webhookSecret, body, { t: Math.floor(Date.now() / 1000) - 600, delivery: `dlv_old_${Date.now()}` });
    expect((await post(a, body, old)).status).toBe(401);
  });

  it('a delivery signed with restaurant A’s secret is rejected on restaurant B’s URL', async () => {
    const body = statusBody(b);
    const h = signed(a.webhookSecret, body);
    expect((await post(b, body, h)).status).toBe(401);
    expect(await stored(h['x-novaryq-delivery'])).toBe(0);
  });

  it('unknown restaurant id -> not 2xx, nothing stored', async () => {
    const body = statusBody(a);
    const h = signed(a.webhookSecret, body);
    const res = await post('cl_does_not_exist_000000', body, h);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await stored(h['x-novaryq-delivery'])).toBe(0);
  });

  it('a restaurant whose integration is disabled does not accept or apply webhooks', async () => {
    const off = await makeShop(sim, { enabled: false });
    const order = await placeCod(off);
    const body = statusBody(off, { externalRef: order.id, status: 'READY' });
    await post(off, body, signed(off.webhookSecret, body));
    await fl.runWorker();
    expect(await statusOf(order.id)).toBe('RECEIVED');
  });
});

describe('webhook size and shape', () => {
  it.each([
    ['with Content-Length', true],
    ['without Content-Length (streamed)', false],
  ])('rejects a body over 64 KiB %s with 413 and stores nothing', async (_n, withLength) => {
    const pad = 'x'.repeat(65 * 1024);
    const body = statusBody(a, { notes: pad });
    const h: Record<string, string> = signed(a.webhookSecret, body);
    let req: Request;
    if (withLength) {
      req = new Request(`http://flavrly.test${webhookPath(a.restaurantId)}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body });
    } else {
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
      req = new Request(`http://flavrly.test${webhookPath(a.restaurantId)}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    }
    const res = await fl.webhookPOST(req, a.restaurantId);
    expect([413, 400]).toContain(res.status);
    expect(await stored(h['x-novaryq-delivery'])).toBe(0);
  });

  it('a lying small Content-Length with a large body is still capped', async () => {
    const body = statusBody(a, { notes: 'y'.repeat(70 * 1024) });
    const h = signed(a.webhookSecret, body);
    const res = await post(a, body, { ...h, 'content-length': '10' });
    expect(res.status).not.toBe(200);
    expect(await stored(h['x-novaryq-delivery'])).toBe(0);
  });

  it('malformed JSON with a valid signature -> 400, nothing stored', async () => {
    const body = '{"eventType":"order.status_changed",';
    const h = signed(a.webhookSecret, body);
    expect((await post(a, body, h)).status).toBe(400);
    expect(await stored(h['x-novaryq-delivery'])).toBe(0);
  });

  it('missing delivery id -> rejected (cannot dedupe)', async () => {
    const body = statusBody(a);
    const h: Record<string, string> = signed(a.webhookSecret, body);
    delete h['x-novaryq-delivery'];
    delete h['x-novaryq-idempotency-key'];
    expect((await post(a, body, h)).status).toBeGreaterThanOrEqual(400);
  });
});

describe('tenant isolation', () => {
  it('a valid webhook from A that names B’s order (externalRef and Novaryq id) never moves B’s order', async () => {
    const order = await placeCod(b);
    await fl.runWorker();
    const nqB = sim.orderByExternalRef(order.id)!;
    for (const status of ['SENT', 'READY', 'VOIDED']) {
      const body = statusBody(a, { orderId: nqB.id, externalRef: order.id, externalCode: order.code, status, locationId: a.location.id });
      expect((await post(a, body, signed(a.webhookSecret, body))).status).toBe(200);
    }
    await fl.runWorker();
    expect(await statusOf(order.id)).toBe('RECEIVED');
    expect(await statusTrail(order.id)).toEqual(['RECEIVED']);
  });

  it('a valid availability event from A never toggles B’s items, even for the same item code', async () => {
    await db.novaryqItemLink.update({ where: { menuItemId: b.paneer.id }, data: { novaryqItemCode: a.paneer.code } });
    const body = JSON.stringify(sim.envelope('menu.item.availability_changed', { itemCode: a.paneer.code, menuItemId: a.paneer.sim.menuItemId, available: false, locationId: null, occurredAt: new Date().toISOString() }));
    const h = { ...signed(a.webhookSecret, body), 'x-novaryq-event': 'menu.item.availability_changed' };
    expect((await post(a, body, h)).status).toBe(200);
    await fl.runWorker();
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: b.paneer.id } })).isAvailable).toBe(true);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: a.paneer.id } })).isAvailable).toBe(false);
  });
});

describe('worker route auth (POST-only, constant-time INTERNAL_CRON_SECRET)', () => {
  it.each([
    ['no secret', {}],
    ['wrong secret', { 'x-internal-secret': 'qa-internal-cron-secreT' }],
    ['wrong length', { 'x-internal-secret': 'x' }],
  ])('%s -> 401/403', async (_n, headers) => {
    const res = await fl.workerRoute(headers as Record<string, string>);
    expect([401, 403]).toContain(res.status);
  });

  it('GET is not served', async () => {
    const res = await fl.workerRoute({ 'x-internal-secret': process.env.INTERNAL_CRON_SECRET! }, 'GET');
    expect(res.status).toBe(405);
  });
});

describe('middleware: the webhook path (and only it) skips CSRF and the API rate limiter', () => {
  it('isWebhookPath matches exactly /api/integrations/novaryq/webhook/<id>', async () => {
    const { isWebhookPath } = await import('@/server/http/csrf');
    expect(isWebhookPath('/api/integrations/novaryq/webhook/cmabc123')).toBe(true);
    expect(isWebhookPath('/api/integrations/novaryq/webhook/cmabc123/')).toBe(true);
    expect(isWebhookPath('/api/integrations/novaryq/webhook/cmabc123/extra')).toBe(false);
    expect(isWebhookPath('/api/integrations/novaryq/webhook')).toBe(false);
    expect(isWebhookPath('/api/integrations/novaryq/settings')).toBe(false);
    expect(isWebhookPath('/api/admin/integrations/novaryq/replay')).toBe(false);
  });
});

describe('SSRF: tenant-supplied baseUrl', () => {
  const blocked = [
    'http://127.0.0.1:4000',
    'https://127.0.0.1',
    'https://localhost',
    'https://169.254.169.254/latest/meta-data',
    'https://10.1.2.3',
    'https://192.168.1.10',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:a9fe:a9fe]',
    'https://[fd00::1]',
    'https://0.0.0.0',
    'https://2130706433',
    'https://user:pw@app.novaryq.com',
  ];
  it.each(blocked)('production refuses %s', async (url) => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(await fl.checkBaseUrl(url, async () => ['127.0.0.1'])).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
      process.env.NOVARYQ_ALLOW_INSECURE_BASE_URL = 'true';
    }
  });

  it('production refuses a public-looking host that resolves to a private address', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(await fl.checkBaseUrl('https://pos.attacker.example', async () => ['10.0.0.5'])).not.toBeNull();
      expect(await fl.checkBaseUrl('https://pos.attacker.example', async () => ['93.184.216.34', '127.0.0.1'])).not.toBeNull();
      expect(await fl.checkBaseUrl('https://app.novaryq.com', async () => ['93.184.216.34'])).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      process.env.NOVARYQ_ALLOW_INSECURE_BASE_URL = 'true';
    }
  });

  it('in production the worker never calls a private baseUrl stored earlier', async () => {
    const s = await makeShop(sim);
    const order = await placeCod(s);
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const before = sim.requests.length;
      await fl.runWorker();
      expect(sim.requests.length).toBe(before);
      expect(sim.orderByExternalRef(order.id)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      process.env.NOVARYQ_ALLOW_INSECURE_BASE_URL = 'true';
    }
  });
});

describe('secrets never leak', () => {
  it('push, failure, webhook and worker logs + stored errors contain no secret material', async () => {
    const s = await makeShop(sim);
    const secrets = [s.key.secret, s.webhookSecret, createHash('sha256').update(s.key.secret).digest('hex')];
    const out: string[] = [];
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation(((c: any) => { out.push(String(c)); return true; }) as any),
      vi.spyOn(process.stderr, 'write').mockImplementation(((c: any) => { out.push(String(c)); return true; }) as any),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...x: any[]) => { out.push(x.map(String).join(' ')); })),
    ];
    try {
      sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 401 });
      const o1 = await placeCod(s);
      await fl.runWorker();
      await db.novaryqOrderSync.updateMany({ where: { orderId: o1.id }, data: { nextAttemptAt: new Date(0) } });
      await fl.runWorker();
      const body = statusBody(s, { externalRef: o1.id });
      await post(s, body, signed('whsec_wrong', body));
      await post(s, body, signed(s.webhookSecret, body));
      await fl.runWorker();
      await saveCfg(s, { secret: 'nqsec_rotated_value_for_qa' });
    } finally {
      spies.forEach((sp) => sp.mockRestore());
    }
    const blob = out.join('\n');
    for (const x of secrets) expect(blob).not.toContain(x);
    const rows = await db.novaryqOrderSync.findMany({ where: { restaurantId: s.restaurantId } });
    const evts = await db.novaryqWebhookEvent.findMany({ where: { restaurantId: s.restaurantId } });
    const stored = JSON.stringify([rows, evts]);
    for (const x of secrets) expect(stored).not.toContain(x);
    const cred = await prisma.integrationCredential.findFirstOrThrow({ where: { restaurantId: s.restaurantId } });
    expect(JSON.stringify(cred.summary ?? {})).not.toContain(s.key.secret);
    expect(JSON.stringify(cred.summary ?? {})).not.toContain(s.webhookSecret);
    expect(cred.configEncrypted).not.toContain(s.webhookSecret);
  });
});
