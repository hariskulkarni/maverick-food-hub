/**
 * Minimal in-memory Prisma stand-in for Flavrly PG attempt/limit unit tests.
 * $transaction runs callbacks one at a time (like the receiving-account row lock) and
 * rolls the whole store back if the callback throws. Real-DB behaviour is proven in tests/db.
 */
type Row = Record<string, any>;

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

function cmp(v: any, cond: any, row: Row, store: Store): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== 'object') return v === cond;
  if ('in' in cond) return cond.in.includes(v);
  if ('not' in cond) return !cmp(v, cond.not, row, store);
  const t = (x: any) => (x instanceof Date ? x.getTime() : x);
  if ('lt' in cond && !(v !== null && v !== undefined && t(v) < t(cond.lt))) return false;
  if ('gt' in cond && !(v !== null && v !== undefined && t(v) > t(cond.gt))) return false;
  if ('gte' in cond && !(v !== null && v !== undefined && t(v) >= t(cond.gte))) return false;
  return true;
}

export function matches(row: Row, where: Row | undefined, store: Store): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(cond as Row[]).some((w) => matches(row, w, store))) return false;
    } else if (k === 'evidence' || k === 'allocations') {
      const rel = store[k].filter((e) => e.attemptId === row.id);
      if ('none' in cond && rel.some((e) => matches(e, cond.none, store))) return false;
    } else if (!cmp(row[k], cond, row, store)) return false;
  }
  return true;
}

function apply(row: Row, data: Row): Row {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) row[k] += v.increment;
    else if (v && typeof v === 'object' && !(v instanceof Date) && 'decrement' in v) row[k] -= v.decrement;
    else row[k] = v;
  }
  row.updatedAt = new Date();
  return row;
}

export type Store = {
  payments: Row[];
  attempts: Row[];
  reservations: Row[];
  usage: Row[];
  exceptions: Row[];
  orders: Row[];
  evidence: Row[];
  allocations: Row[];
  accounts: Row[];
};

function model(store: Store, table: keyof Store, prefix: string, extra: Row = {}) {
  const rows = () => store[table];
  return {
    findUnique: async ({ where }: Row) => rows().find((r) => matches(r, where, store)) ?? null,
    findFirst: async ({ where }: Row) => rows().find((r) => matches(r, where, store)) ?? null,
    findMany: async ({ where, include, orderBy, take }: Row = {}) => {
      let out = rows().filter((r) => matches(r, where, store));
      if (orderBy) {
        const [[k, dir]] = Object.entries(orderBy) as [string, string][];
        out = [...out].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => (include?.payment ? { ...r, payment: store.payments.find((p) => p.id === r.paymentId) } : { ...r }));
    },
    count: async ({ where }: Row = {}) => rows().filter((r) => matches(r, where, store)).length,
    create: async ({ data }: Row) => {
      const row = { id: id(prefix), createdAt: new Date(), updatedAt: new Date(), ...extra, ...data };
      for (const u of (extra.__unique as string[][]) ?? []) {
        if (rows().some((r) => u.every((k) => r[k] === row[k]))) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      delete row.__unique;
      rows().push(row);
      return { ...row };
    },
    createMany: async ({ data, skipDuplicates }: Row) => {
      let n = 0;
      for (const d of data) {
        const u = (extra.__unique as string[][])?.[0] ?? [];
        if (skipDuplicates && rows().some((r) => u.every((k) => +r[k] === +d[k] || r[k] === d[k]))) continue;
        rows().push({ id: id(prefix), createdAt: new Date(), updatedAt: new Date(), ...d });
        n++;
      }
      return { count: n };
    },
    update: async ({ where, data }: Row) => {
      const r = rows().find((x) => matches(x, where, store));
      if (!r) throw new Error(`${table} not found`);
      return { ...apply(r, data) };
    },
    updateMany: async ({ where, data }: Row) => {
      const hit = rows().filter((r) => matches(r, where, store));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: Row) => {
      const r = rows().find((x) => matches(x, where, store));
      if (r) return { ...apply(r, update) };
      const row = { id: id(prefix), status: 'OPEN', createdAt: new Date(), updatedAt: new Date(), ...create };
      rows().push(row);
      return { ...row };
    },
  };
}

export function emptyStore(): Store {
  return { payments: [], attempts: [], reservations: [], usage: [], exceptions: [], orders: [], evidence: [], allocations: [], accounts: [] };
}

export function fakePrisma(store: Store) {
  let chain: Promise<unknown> = Promise.resolve();
  const client: Row = {
    payment: model(store, 'payments', 'pay'),
    pgPaymentAttempt: model(store, 'attempts', 'att', { lastGatewayStatus: null, gatewayPaymentId: null, expiresAt: null, __unique: [['attemptKey']] }),
    pgLimitReservation: model(store, 'reservations', 'res', { state: 'RESERVED', __unique: [['attemptId']] }),
    pgAccountDailyUsage: model(store, 'usage', 'use', { __unique: [['receivingAccountId', 'day']] }),
    pgReconException: model(store, 'exceptions', 'exc'),
    order: model(store, 'orders', 'ord'),
    $queryRaw: async (_s: TemplateStringsArray, accountId: string) =>
      store.accounts.filter((a) => a.id === accountId).map((a) => ({ id: a.id })),
  };
  client.$transaction = (fn: (tx: unknown) => Promise<unknown>) => {
    const run = chain.then(async () => {
      const snap = structuredClone(store);
      try {
        return await fn(client);
      } catch (e) {
        for (const k of Object.keys(store) as (keyof Store)[]) store[k] = snap[k];
        throw e;
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
  return client;
}
