/**
 * In-memory Novaryq Partner API simulator (CONTRACT §1–§2) for Flavrly tests.
 *
 * One simulator = one Novaryq tenant. It serves the partner routes over real HTTP (node:http on
 * 127.0.0.1) so the Flavrly client is exercised end to end, and it sends signed webhooks through
 * a pluggable transport (real fetch by default; tests can route them into a Next route handler).
 *
 * Faithful to:  HMAC verification incl. 300 s skew (signing.ts), 120 req/min/key sliding window,
 * scopes, error shape { statusCode, error, message }, list shape { data, page, pageSize, total },
 * no API-key webhook CRUD (CONTRACT-CHANGES NQ-1: subscriptions are console-only -> addSubscription),
 * POST /orders idempotency on (tenant, source, externalRef) -> 201 / 200 + idempotentReplay,
 * 422 unknownItemCodes (all of them), 422 currency mismatch, cancel rules (§2.3), §2.4 payloads,
 * webhook headers + at-least-once retries (8 attempts), Novaryq's DomainEvent envelope.
 *
 * Fault injection: injectFault() for 429+Retry-After, 5xx, slow responses (client timeouts),
 * connection resets, and "after" faults that commit the write and then lose the response.
 * Webhook injection: duplicates (redeliver), out-of-order (hold + releaseHeld('reverse')),
 * exact-byte replays (replayRaw), and arbitrary raw posts (sendRaw) for forgery/oversize.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { sha256hex, signWebhook, verifyApiSignature } from './signing';

export type NqOrderStatus = 'OPEN' | 'SENT' | 'IN_PREP' | 'READY' | 'COMPLETED' | 'VOIDED' | 'REFUNDED';
export const SERVICE_MODES = ['DINE_IN', 'TAKEOUT', 'DELIVERY', 'CURBSIDE', 'DRIVE_THRU', 'KIOSK', 'ONLINE', 'BAR_TAB'] as const;
export const CANCEL_REASONS = ['customer_cancelled', 'restaurant_cancelled', 'admin_cancelled', 'other'] as const;
export const MAX_ATTEMPTS = 8;
/** Novaryq dev-platform/event-catalog.ts: a subscription name also receives these fired events. */
export const PUBLIC_EVENT_ALIASES: Record<string, string[]> = {
  'order.status_changed': ['order.status_changed', 'order.sent', 'order.closed', 'order.updated'],
  'menu.item.availability_changed': ['menu.item.86ed', 'menu.item.restored'],
};
/** Operator 'send test' / manual redeliver use the helper default, not the catalog's 8. */
export const AD_HOC_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_PER_MIN = 120;

export interface SimApiKey { clientId: string; secret: string; scopes: string[]; isActive: boolean }
export interface SimLocation { id: string; name: string; currency: string }
export interface SimModifierGroup { name: string; options: { name: string; price: string }[] }
export interface SimItem {
  menuItemId: string;
  sku?: string | null;
  shortCode?: string | null;
  name: string;
  price: string;
  categoryName: string;
  available: boolean;
  /** Per-location 86 overrides. */
  locationAvailable: Record<string, boolean>;
  modifierGroups: SimModifierGroup[];
}
export interface SimOrder {
  id: string;
  orderNumber: number;
  locationId: string;
  status: NqOrderStatus;
  source: string;
  externalRef: string | null;
  externalCode: string | null;
  currency: string;
  grandTotal: string;
  serviceMode: string;
  apiClientId: string;
  /** The exact JSON body that created the order (what Flavrly sent). */
  request: any;
  createdAt: string;
  cancel?: { reason: string; note?: string };
  /** Payload-mismatch replays that were logged (contract: warn, never mutate). */
  replayWarnings: string[];
}
export interface SimSubscription { id: string; url: string; events: string[]; secret: string; isActive: boolean; createdAt: string }
export interface SimRequestLog {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
  status: number;
  authError?: string;
  clientId?: string;
  at: number;
}
export interface SimAttempt { attempt: number; at: number; status: number | null; error?: string; headers: Record<string, string>; body: string }
export interface SimDelivery {
  id: string;
  subscriptionId: string;
  url: string;
  eventType: string;
  envelope: any;
  body: string;
  maxAttempts: number;
  attempts: SimAttempt[];
  state: 'pending' | 'delivered' | 'dead';
  held: boolean;
}

export type FaultPhase = 'before' | 'after';
export type Fault =
  | { kind: 'status'; status: number; retryAfterSec?: number; phase?: FaultPhase }
  | { kind: 'delay'; ms: number; phase?: FaultPhase }
  | { kind: 'reset'; phase?: FaultPhase };
interface FaultRule { method: string; path: RegExp; fault: Fault; remaining: number }

export type WebhookTransport = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<number>;

export const fetchTransport =
  (timeoutMs = 10_000): WebhookTransport =>
  async (url, init) => {
    const res = await fetch(url, { method: 'POST', headers: init.headers, body: init.body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  };

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};

class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}, public headers: Record<string, string> = {}) {
    super(message);
  }
}

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const EXTERNAL_REF = /^[A-Za-z0-9_-]{1,64}$/;

export interface SimulatorOptions {
  tenantId?: string;
  /** Status a channel order lands in (contract: kitchen-visible, SENT-equivalent). */
  channelOrderInitialStatus?: NqOrderStatus;
  /** Emit order.status_changed OPEN -> initial status on create (if initial ≠ OPEN). */
  emitOnCreate?: boolean;
  /** Event names for availability (NQ documents the final names; §2.4). */
  availabilityEvents?: { off: string; on: string };
  /** Also fire Novaryq's legacy order.sent / order.updated / order.closed facts (default true, as real Novaryq). */
  legacyEvents?: boolean;
  transport?: WebhookTransport;
  rateLimitPerMin?: number;
  now?: () => number;
}

export class NovaryqSimulator {
  readonly tenantId: string;
  readonly keys = new Map<string, SimApiKey>();
  readonly locations = new Map<string, SimLocation>();
  readonly items: SimItem[] = [];
  readonly orders = new Map<string, SimOrder>();
  readonly subscriptions = new Map<string, SimSubscription>();
  readonly deliveries: SimDelivery[] = [];
  readonly requests: SimRequestLog[] = [];
  readonly warnings: string[] = [];
  hold = false;
  transport: WebhookTransport;
  opts: Required<Omit<SimulatorOptions, 'transport' | 'tenantId'>>;
  private faults: FaultRule[] = [];
  private rate = new Map<string, number[]>();
  private server?: Server;
  private orderSeq = 0;
  baseUrl = '';

  constructor(o: SimulatorOptions = {}) {
    this.tenantId = o.tenantId ?? `ten_${randomBytes(6).toString('hex')}`;
    this.transport = o.transport ?? fetchTransport();
    this.opts = {
      channelOrderInitialStatus: o.channelOrderInitialStatus ?? 'SENT',
      emitOnCreate: o.emitOnCreate ?? true,
      availabilityEvents: o.availabilityEvents ?? { off: 'menu.item.86ed', on: 'menu.item.restored' },
      legacyEvents: o.legacyEvents ?? true,
      rateLimitPerMin: o.rateLimitPerMin ?? RATE_LIMIT_PER_MIN,
      now: o.now ?? Date.now,
    };
  }

  // ---------------------------------------------------------------- seeding

  addKey(scopes = ['read:menu', 'write:menu', 'read:orders', 'write:orders']): SimApiKey {
    const k = { clientId: `nq_test_${randomBytes(12).toString('hex')}`, secret: `nqsec_${randomBytes(24).toString('hex')}`, scopes, isActive: true };
    this.keys.set(k.clientId, k);
    return k;
  }

  addLocation(currency = 'INR', name = 'Main'): SimLocation {
    const l = { id: `loc_${randomBytes(8).toString('hex')}`, name, currency };
    this.locations.set(l.id, l);
    return l;
  }

  addItem(i: Partial<SimItem> & { name: string; price: string }): SimItem {
    const item: SimItem = {
      menuItemId: i.menuItemId ?? `mi_${randomBytes(8).toString('hex')}`,
      sku: i.sku ?? null,
      shortCode: i.shortCode ?? null,
      name: i.name,
      price: i.price,
      categoryName: i.categoryName ?? 'Mains',
      available: i.available ?? true,
      locationAvailable: i.locationAvailable ?? {},
      modifierGroups: i.modifierGroups ?? [],
    };
    this.items.push(item);
    return item;
  }

  /** itemCode precedence as createOrder resolves it: sku → shortCode → id (§2.5). */
  static itemCode(i: SimItem): string {
    return i.sku || i.shortCode || i.menuItemId;
  }

  findItem(code: string): SimItem | undefined {
    return (
      this.items.find((i) => i.sku === code) ??
      this.items.find((i) => i.shortCode === code) ??
      this.items.find((i) => i.menuItemId === code)
    );
  }

  // ---------------------------------------------------------------- server

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', r));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server!.close(() => r()));
    this.server = undefined;
  }

  /** Inject a fault for the next `times` requests matching `METHOD /path-regex`. */
  injectFault(route: string, fault: Fault, times = 1): void {
    const [method, ...rest] = route.split(' ');
    this.faults.push({ method: method!.toUpperCase(), path: new RegExp(`^${rest.join(' ')}$`), fault, remaining: times });
  }

  clearFaults(): void {
    this.faults = [];
  }

  requestsTo(method: string, path: RegExp | string): SimRequestLog[] {
    return this.requests.filter((r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)));
  }

  private takeFault(method: string, path: string): Fault | undefined {
    const rule = this.faults.find((f) => f.remaining > 0 && f.method === method && f.path.test(path));
    if (!rule) return undefined;
    rule.remaining -= 1;
    return rule.fault;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://sim');
    const method = (req.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')]));
    const log: SimRequestLog = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, rawBody, status: 0, at: this.opts.now() };
    this.requests.push(log);

    const send = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
      log.status = status;
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
      res.end(JSON.stringify(body));
    };
    const applyFault = async (f: Fault): Promise<boolean> => {
      if (f.kind === 'reset') {
        log.status = -1;
        req.socket.destroy();
        return true;
      }
      if (f.kind === 'delay') {
        await new Promise((r) => setTimeout(r, f.ms));
        return false; // continue normally after the delay (client may have given up)
      }
      const extra: Record<string, string> = f.retryAfterSec !== undefined ? { 'retry-after': String(f.retryAfterSec) } : {};
      send(f.status, { statusCode: f.status, error: STATUS_TEXT[f.status] ?? 'Error', message: `Injected ${f.status}`, ...(f.retryAfterSec !== undefined ? { retryAfterSec: f.retryAfterSec } : {}) }, extra);
      return true;
    };

    const fault = this.takeFault(method, url.pathname);
    if (fault && (fault.phase ?? 'before') === 'before' && (await applyFault(fault))) return;

    let status = 200;
    let body: unknown;
    let outHeaders: Record<string, string> = {};
    try {
      const key = this.authenticate(headers, rawBody, log);
      ({ status, body } = await this.route(method, url, rawBody, key));
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        body = { statusCode: e.status, error: STATUS_TEXT[e.status] ?? 'Error', message: e.message, ...e.extra };
        outHeaders = e.headers;
      } else {
        status = 500;
        body = { statusCode: 500, error: 'Internal Server Error', message: (e as Error).message };
      }
    }
    if (fault && fault.phase === 'after' && (await applyFault(fault))) return; // write committed, response lost
    send(status, body, outHeaders);
  }

  private authenticate(headers: Record<string, string>, rawBody: string, log: SimRequestLog): SimApiKey {
    const clientId = headers['x-api-key'];
    const fail = (m: string) => {
      log.authError = m;
      return new HttpError(401, m);
    };
    if (!clientId) throw fail('Missing x-api-key header');
    const key = this.keys.get(clientId);
    if (!key) throw fail('Unknown API key');
    if (!key.isActive) throw fail('API key is revoked');
    log.clientId = clientId;
    // Per-key sliding window, as ApiKeyGuard.budget (checked before the signature).
    const now = this.opts.now();
    const win = (this.rate.get(clientId) ?? []).filter((t) => t > now - 60_000);
    if (win.length >= this.opts.rateLimitPerMin) {
      const retry = Math.max(1, Math.ceil((win[0]! + 60_000 - now) / 1000));
      this.rate.set(clientId, win);
      throw new HttpError(429, `Rate limit exceeded (${this.opts.rateLimitPerMin}/min). Retry in ${retry}s.`, { retryAfterSec: retry }, { 'retry-after': String(retry) });
    }
    win.push(now);
    this.rate.set(clientId, win);
    const reason = verifyApiSignature(sha256hex(key.secret), rawBody, headers['x-timestamp'], headers['x-signature'], now);
    if (reason) throw fail(reason);
    return key;
  }

  private need(key: SimApiKey, scope: string) {
    if (!key.scopes.includes(scope)) throw new HttpError(403, `API key missing scope(s): ${scope}`);
  }

  private parse(rawBody: string): any {
    if (!rawBody) return {};
    try {
      return JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, 'Malformed JSON body');
    }
  }

  private async route(method: string, url: URL, rawBody: string, key: SimApiKey): Promise<{ status: number; body: unknown }> {
    const p = url.pathname;
    const q = url.searchParams;
    let m: RegExpMatchArray | null;
    if (method === 'GET' && p === '/api/v1/me') return { status: 200, body: { tenantId: this.tenantId, authenticated: true } };
    if (method === 'GET' && p === '/api/v1/menu') {
      this.need(key, 'read:menu');
      return { status: 200, body: this.menu(q.get('locationId') ?? undefined) };
    }
    if (method === 'PATCH' && (m = p.match(/^\/api\/v1\/menu\/items\/([^/]+)\/availability$/))) {
      this.need(key, 'write:menu');
      const b = this.parse(rawBody);
      if (typeof b.available !== 'boolean') throw new HttpError(400, 'available must be a boolean');
      const item = this.findItem(decodeURIComponent(m[1]!));
      if (!item) throw new HttpError(404, 'Menu item not found');
      this.set86(NovaryqSimulator.itemCode(item), b.available, null);
      return { status: 200, body: { itemCode: NovaryqSimulator.itemCode(item), available: item.available } };
    }
    if (method === 'GET' && p === '/api/v1/orders') {
      this.need(key, 'read:orders');
      const rows = [...this.orders.values()].filter(
        (o) =>
          (!q.get('externalRef') || o.externalRef === q.get('externalRef')) &&
          (!q.get('source') || o.source === q.get('source')) &&
          (!q.get('locationId') || o.locationId === q.get('locationId')) &&
          (!q.get('status') || o.status === q.get('status')),
      );
      return { status: 200, body: { data: rows.map((o) => this.orderView(o, false)), page: 1, pageSize: rows.length, total: rows.length } };
    }
    if (method === 'GET' && (m = p.match(/^\/api\/v1\/orders\/([^/]+)$/))) {
      this.need(key, 'read:orders');
      const o = this.orders.get(m[1]!);
      if (!o) throw new HttpError(404, 'Order not found');
      return { status: 200, body: this.orderView(o, false) };
    }
    if (method === 'POST' && p === '/api/v1/orders') {
      this.need(key, 'write:orders');
      return this.createOrder(this.parse(rawBody), key);
    }
    if (method === 'POST' && (m = p.match(/^\/api\/v1\/orders\/([^/]+)\/cancel$/))) {
      this.need(key, 'write:orders');
      return this.cancelOrder(m[1]!, this.parse(rawBody), key);
    }
    throw new HttpError(404, `Cannot ${method} ${p}`);
  }

  // ---------------------------------------------------------------- menu

  private menu(locationId?: string) {
    if (locationId && !this.locations.has(locationId)) throw new HttpError(404, 'Location not found');
    const data = this.items.map((i) => {
      const currency = locationId ? this.locations.get(locationId)!.currency : ([...this.locations.values()][0]?.currency ?? 'INR');
      return {
        itemCode: NovaryqSimulator.itemCode(i),
        id: i.menuItemId,
        name: i.name,
        price: i.price,
        currency,
        available: locationId && locationId in i.locationAvailable ? i.locationAvailable[locationId]! : i.available,
        categoryName: i.categoryName,
        modifierGroups: i.modifierGroups,
      };
    });
    return { data, page: 1, pageSize: data.length, total: data.length };
  }

  /** 86 / un-86 an item (tenant-wide when locationId is null) and emit the availability event. */
  set86(itemCode: string, available: boolean, locationId: string | null, occurredAt = new Date(this.opts.now()).toISOString()): SimDelivery[] {
    const item = this.findItem(itemCode);
    if (!item) throw new Error(`sim: unknown item ${itemCode}`);
    if (locationId) item.locationAvailable[locationId] = available;
    else item.available = available;
    const event = available ? this.opts.availabilityEvents.on : this.opts.availabilityEvents.off;
    return this.emit(event, { itemCode: NovaryqSimulator.itemCode(item), menuItemId: item.menuItemId, available, locationId, occurredAt }, locationId ?? undefined);
  }

  // ---------------------------------------------------------------- orders

  private createOrder(b: any, key: SimApiKey): { status: number; body: unknown } {
    if (!b.locationId || typeof b.locationId !== 'string') throw new HttpError(400, 'locationId is required');
    const loc = this.locations.get(b.locationId);
    if (!loc) throw new HttpError(404, 'Location not found');
    const source = typeof b.source === 'string' && b.source ? b.source : 'api';
    if (b.externalRef !== undefined && (typeof b.externalRef !== 'string' || !EXTERNAL_REF.test(b.externalRef)))
      throw new HttpError(400, 'externalRef must be ≤64 chars of [A-Za-z0-9_-]');
    if (b.externalCode !== undefined && (typeof b.externalCode !== 'string' || b.externalCode.length > 32)) throw new HttpError(400, 'externalCode must be ≤32 chars');
    if (b.deliveryAddress !== undefined && (typeof b.deliveryAddress !== 'string' || b.deliveryAddress.length > 500))
      throw new HttpError(400, 'deliveryAddress must be ≤500 chars');
    if (b.serviceMode !== undefined && !SERVICE_MODES.includes(b.serviceMode)) throw new HttpError(400, `Unknown serviceMode ${b.serviceMode}`);

    // Idempotency first: a replay returns the existing order even if the payload drifted.
    if (b.externalRef) {
      const existing = [...this.orders.values()].find((o) => o.source === source && o.externalRef === b.externalRef);
      if (existing) {
        if (JSON.stringify(existing.request) !== JSON.stringify(b)) {
          const w = `replay with different payload for ${source}/${b.externalRef}`;
          existing.replayWarnings.push(w);
          this.warnings.push(w);
        }
        return { status: 200, body: this.orderView(existing, true) };
      }
    }

    if (b.currency !== undefined && b.currency !== loc.currency)
      throw new HttpError(422, `currency ${b.currency} does not match location currency ${loc.currency}`);
    const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) throw new HttpError(400, 'lines must not be empty');
    const unknown: string[] = [];
    for (const l of lines) {
      const code = l.itemCode ?? l.menuItemId;
      if (!code || !this.findItem(code)) unknown.push(String(code ?? '(none)'));
      if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new HttpError(400, 'quantity must be a positive integer');
      if (l.unitPrice !== undefined && !(typeof l.unitPrice === 'string' && MONEY.test(l.unitPrice))) throw new HttpError(400, 'unitPrice must be a decimal string');
      for (const mod of l.modifiers ?? []) {
        if (typeof mod.name !== 'string' || !(typeof mod.unitPrice === 'string' && MONEY.test(mod.unitPrice))) throw new HttpError(400, 'modifier needs name + decimal-string unitPrice');
      }
    }
    if (unknown.length) throw new HttpError(422, `Unknown item code(s): ${unknown.join(', ')}`, { unknownItemCodes: unknown });
    for (const [k, v] of Object.entries(b.totals ?? {})) {
      if (!(typeof v === 'string' && MONEY.test(v))) throw new HttpError(400, `totals.${k} must be a decimal string`);
    }
    if (b.totals && b.totals.grandTotal === undefined) throw new HttpError(400, 'totals.grandTotal is required');
    if (b.payment) {
      if (!['PREPAID', 'UNPAID'].includes(b.payment.status)) throw new HttpError(400, 'payment.status must be PREPAID or UNPAID');
      if (b.payment.amount !== undefined && !(typeof b.payment.amount === 'string' && MONEY.test(b.payment.amount))) throw new HttpError(400, 'payment.amount must be a decimal string');
    }

    // Channel price wins; otherwise base price (the POS never re-prices channel figures).
    const priced = lines.reduce((s, l) => s + toPaise(l.unitPrice ?? this.findItem(l.itemCode ?? l.menuItemId)!.price) * l.quantity, 0);
    const grandTotal = b.totals?.grandTotal ?? fromPaise(priced);
    const initial = this.opts.channelOrderInitialStatus;
    const o: SimOrder = {
      id: `ord_${randomBytes(10).toString('hex')}`,
      orderNumber: ++this.orderSeq,
      locationId: loc.id,
      status: initial,
      source,
      externalRef: b.externalRef ?? null,
      externalCode: b.externalCode ?? null,
      currency: loc.currency,
      grandTotal,
      serviceMode: b.serviceMode ?? 'DINE_IN',
      apiClientId: key.clientId,
      request: b,
      createdAt: new Date(this.opts.now()).toISOString(),
      replayWarnings: [],
    };
    this.orders.set(o.id, o);
    this.emit('order.created', { orderId: o.id, locationId: o.locationId, orderNumber: o.orderNumber, source: o.source }, o.locationId);
    if (initial !== 'OPEN' && this.opts.emitOnCreate) this.emitStatus(o, 'OPEN');
    if (initial === 'SENT' && this.opts.legacyEvents)
      this.emit('order.sent', { orderId: o.id, locationId: o.locationId, orderNumber: o.orderNumber, ticketCount: lines.length, heldCourses: false }, o.locationId);
    return { status: 201, body: this.orderView(o, false) };
  }

  private orderView(o: SimOrder, idempotentReplay: boolean) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      locationId: o.locationId,
      status: o.status,
      source: o.source,
      externalRef: o.externalRef,
      externalCode: o.externalCode,
      currency: o.currency,
      grandTotal: o.grandTotal,
      idempotentReplay,
    };
  }

  private cancelOrder(id: string, b: any, key: SimApiKey): { status: number; body: unknown } {
    if (!CANCEL_REASONS.includes(b.reason)) throw new HttpError(400, `reason must be one of ${CANCEL_REASONS.join(', ')}`);
    if (b.note !== undefined && typeof b.note !== 'string') throw new HttpError(400, 'note must be a string');
    const o = this.orders.get(id);
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.apiClientId !== key.clientId) throw new HttpError(403, 'Order was not created by this API client');
    if (o.status === 'VOIDED') return { status: 200, body: this.orderView(o, false) };
    if (o.status === 'COMPLETED' || o.status === 'REFUNDED') throw new HttpError(409, `Order is ${o.status} and cannot be cancelled`);
    o.cancel = { reason: b.reason, note: b.note };
    this.advance(o.id, 'VOIDED');
    return { status: 200, body: this.orderView(o, false) };
  }

  /** Kitchen action in the POS: move an order and emit order.status_changed (§2.4). */
  advance(orderId: string, status: NqOrderStatus, occurredAt?: string): SimDelivery[] {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`sim: unknown order ${orderId}`);
    const prev = o.status;
    o.status = status;
    const out = this.emitStatus(o, prev, occurredAt);
    // Real Novaryq also fires these legacy facts (kds.service bumpReady, pay-links close); payloads have no source/externalRef.
    if (this.opts.legacyEvents && status === 'READY') out.push(...this.emit('order.updated', { orderId: o.id, locationId: o.locationId, status: 'READY' }, o.locationId));
    if (this.opts.legacyEvents && status === 'COMPLETED') out.push(...this.emit('order.closed', { orderId: o.id, locationId: o.locationId, grandTotal: o.grandTotal }, o.locationId));
    return out;
  }

  orderByExternalRef(externalRef: string, source = 'flavrly'): SimOrder | undefined {
    return [...this.orders.values()].find((o) => o.externalRef === externalRef && o.source === source);
  }

  private emitStatus(o: SimOrder, previousStatus: NqOrderStatus, occurredAt = new Date(this.opts.now()).toISOString()): SimDelivery[] {
    return this.emit(
      'order.status_changed',
      {
        orderId: o.id,
        orderNumber: o.orderNumber,
        locationId: o.locationId,
        source: o.source,
        externalRef: o.externalRef,
        externalCode: o.externalCode,
        status: o.status,
        previousStatus,
        occurredAt,
      },
      o.locationId,
    );
  }

  // ---------------------------------------------------------------- webhook subscriptions

  /**
   * Console-side subscription management (Novaryq -> Developer -> Webhooks, staff JWT). Per
   * CONTRACT-CHANGES NQ-1 there is NO API-key route for this; the owner creates the subscription
   * and pastes the returned whsec_ secret into Flavrly. Returns the secret, like the console.
   */
  addSubscription(url: string, events: string[], secret?: string): SimSubscription {
    const s: SimSubscription = {
      id: `whs_${randomBytes(8).toString('hex')}`,
      url,
      events: [...new Set(events)],
      secret: secret?.trim() || `whsec_${randomBytes(24).toString('hex')}`,
      isActive: true,
      createdAt: new Date(this.opts.now()).toISOString(),
    };
    this.subscriptions.set(s.id, s);
    return s;
  }

  /** Console "Send test": webhook.test with Novaryq's ad-hoc envelope (payload, no data) and 5 attempts. */
  sendTest(subscriptionId: string): SimDelivery {
    const s = this.subscriptions.get(subscriptionId);
    if (!s) throw new Error(`sim: unknown subscription ${subscriptionId}`);
    const env = {
      id: randomUUID(),
      tenantId: this.tenantId,
      eventType: 'webhook.test',
      payload: { message: 'Novaryq Open Platform test event', subscriptionId: s.id },
      occurredAt: new Date(this.opts.now()).toISOString(),
    };
    return this.queue(s, 'webhook.test', env, AD_HOC_MAX_ATTEMPTS);
  }

  // ---------------------------------------------------------------- outbound webhooks

  /** Novaryq DomainEvent envelope (packages/shared/src/events.ts createDomainEvent). */
  envelope(eventType: string, data: unknown, locationId?: string) {
    const eventId = randomUUID();
    return {
      eventId,
      eventType,
      eventVersion: 1,
      occurredAt: new Date(this.opts.now()).toISOString(),
      tenantId: this.tenantId,
      ...(locationId ? { locationId } : {}),
      correlationId: eventId,
      data,
      id: eventId,
      aggregate: eventType.split('.')[0],
      aggregateId: (data as any)?.orderId ?? (data as any)?.menuItemId ?? eventId,
      payload: data,
    };
  }

  /** Queue one event for every active matching subscription. Delivered by flush()/deliver(). */
  emit(eventType: string, data: unknown, locationId?: string): SimDelivery[] {
    const env = this.envelope(eventType, data, locationId);
    return [...this.subscriptions.values()]
      .filter((s) => s.isActive && s.events.some((e) => e === eventType || PUBLIC_EVENT_ALIASES[e]?.includes(eventType)))
      .map((s) => this.queue(s, eventType, env));
  }

  private queue(s: SimSubscription, eventType: string, env: any, maxAttempts = MAX_ATTEMPTS): SimDelivery {
    const body = JSON.stringify(env);
    const d: SimDelivery = { id: `dlv_${randomBytes(10).toString('hex')}`, subscriptionId: s.id, url: s.url, eventType, envelope: env, body, maxAttempts, attempts: [], state: 'pending', held: this.hold };
    this.deliveries.push(d);
    return d;
  }

  /** One signed attempt (fresh timestamp each attempt, stable delivery id). */
  async attempt(d: SimDelivery): Promise<SimAttempt> {
    const s = this.subscriptions.get(d.subscriptionId);
    const n = d.attempts.length + 1;
    const t = Math.floor(this.opts.now() / 1000);
    const headers = {
      'content-type': 'application/json',
      'x-novaryq-signature': signWebhook(s?.secret ?? '', d.body, t),
      'x-novaryq-timestamp': String(t),
      'x-novaryq-event': d.eventType,
      'x-novaryq-delivery': d.id,
      'x-novaryq-idempotency-key': d.id,
      'x-novaryq-attempt': String(n),
      'x-novaryq-max-attempts': String(d.maxAttempts),
      'user-agent': 'Novaryq-Webhooks/2',
    };
    const a: SimAttempt = { attempt: n, at: this.opts.now(), status: null, headers, body: d.body };
    try {
      a.status = await this.transport(d.url, { headers, body: d.body });
    } catch (e) {
      a.error = (e as Error).message;
    }
    d.attempts.push(a);
    if (a.status !== null && a.status >= 200 && a.status < 300) d.state = 'delivered';
    else if (n >= d.maxAttempts) d.state = 'dead';
    return a;
  }

  /** Attempt every pending, un-held delivery until all are delivered/dead (no real backoff wait). */
  async flush(maxRounds = MAX_ATTEMPTS): Promise<SimDelivery[]> {
    for (let round = 0; round < maxRounds; round++) {
      const due = this.deliveries.filter((d) => d.state === 'pending' && !d.held);
      if (!due.length) break;
      for (const d of due) await this.attempt(d);
    }
    return this.deliveries;
  }

  /** Release held deliveries in emit order or reversed (out-of-order injection), then flush. */
  async releaseHeld(order: 'emit' | 'reverse' = 'emit'): Promise<void> {
    this.hold = false;
    const held = this.deliveries.filter((d) => d.held);
    if (order === 'reverse') held.reverse();
    for (const d of held) {
      d.held = false;
      await this.attempt(d);
    }
    await this.flush();
  }

  /** At-least-once duplicate: send an already-delivered delivery again (new attempt, valid signature). */
  async redeliver(d: SimDelivery): Promise<SimAttempt> {
    return this.attempt(d);
  }

  /** Exact-byte replay of a recorded attempt (old timestamp + old signature). */
  async replayRaw(d: SimDelivery, attemptIndex = 0): Promise<number | null> {
    const a = d.attempts[attemptIndex]!;
    try {
      return await this.transport(d.url, { headers: a.headers, body: a.body });
    } catch {
      return null;
    }
  }

  /** Arbitrary post to a URL (forgery / oversize / malformed tests). */
  async sendRaw(url: string, headers: Record<string, string>, body: string): Promise<number | null> {
    try {
      return await this.transport(url, { headers, body });
    } catch {
      return null;
    }
  }
}

export function toPaise(s: string): number {
  if (!MONEY.test(s)) throw new Error(`bad money ${s}`);
  const [r, f = ''] = s.split('.');
  return Number(r) * 100 + Number((f + '00').slice(0, 2));
}

export function fromPaise(p: number): string {
  return `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
}
