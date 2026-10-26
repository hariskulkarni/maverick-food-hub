/**
 * Data for the super-admin Novaryq console (/platform/novaryq): every restaurant, its
 * integration state, health, linking progress and order flow. Management of a single
 * restaurant happens on /platform/novaryq/[restaurantId] through the same admin API
 * (SUPER_ADMIN + explicit restaurantId, see novaryqAdminGate).
 */
import { prisma } from '../db';
import { computeHealth, type Health } from './health';
import { novaryqFlagOn } from './config';

export type IntegrationState = 'not_set_up' | 'test_failed' | 'paused' | 'on';
export type ConsoleView = 'all' | 'on' | 'attention' | 'not_set_up';

export interface ConsoleRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  city: string | null;
  state: IntegrationState;
  health: Health;
  menuMaster: boolean;
  branchesLinked: number;
  branchesTotal: number;
  itemsLinked: number;
  sent: number;
  sent24h: number;
  failed: number;
  dead: number;
  lastWebhookAt: Date | null;
  lastError: string | null;
}

const LIMIT = 200;

export async function platformNovaryqConsole(opts: { q?: string; view?: ConsoleView }) {
  const q = opts.q?.trim();
  const where = q
    ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { slug: { contains: q, mode: 'insensitive' as const } }] }
    : {};
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [restaurants, total, creds, locs, items, byState, sent24, retrying, hooks] = await Promise.all([
    prisma.restaurant.findMany({
      where,
      orderBy: { name: 'asc' },
      take: LIMIT,
      select: { id: true, name: true, slug: true, status: true, branches: { select: { id: true, city: true } } },
    }),
    prisma.restaurant.count({ where }),
    prisma.integrationCredential.findMany({
      where: { provider: 'NOVARYQ' },
      select: { restaurantId: true, status: true, summary: true, lastError: true },
    }),
    prisma.novaryqLocationLink.groupBy({ by: ['restaurantId'], _count: { _all: true } }),
    prisma.novaryqItemLink.groupBy({ by: ['restaurantId'], _count: { _all: true } }),
    prisma.novaryqOrderSync.groupBy({ by: ['restaurantId', 'state'], _count: { _all: true } }),
    prisma.novaryqOrderSync.groupBy({ by: ['restaurantId'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.novaryqOrderSync.groupBy({
      by: ['restaurantId'], where: { state: { in: ['PENDING', 'CANCEL_PENDING'] }, attempts: { gt: 1 } }, _count: { _all: true },
    }),
    prisma.novaryqWebhookEvent.groupBy({ by: ['restaurantId'], _max: { receivedAt: true } }),
  ]);
  const per = (rows: Array<{ restaurantId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.restaurantId === id)?._count._all ?? 0;
  const count = (id: string, state: string) =>
    byState.find((r) => r.restaurantId === id && r.state === state)?._count._all ?? 0;

  const all: ConsoleRow[] = restaurants.map((r) => {
    const cred = creds.find((c) => c.restaurantId === r.id);
    const summary = (cred?.summary ?? null) as { enabled?: boolean; menuMaster?: boolean } | null;
    const enabled = summary?.enabled === true;
    const connected = cred?.status === 'CONNECTED';
    const state: IntegrationState = !cred ? 'not_set_up' : !connected ? 'test_failed' : enabled ? 'on' : 'paused';
    const failed = count(r.id, 'FAILED');
    const dead = count(r.id, 'DEAD');
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: String(r.status),
      city: r.branches[0]?.city ?? null,
      state,
      health: computeHealth({ hasCred: !!cred, connected, enabled, dead, failed, retrying: per(retrying, r.id) }),
      menuMaster: summary?.menuMaster === true,
      branchesLinked: per(locs, r.id),
      branchesTotal: r.branches.length,
      itemsLinked: per(items, r.id),
      sent: count(r.id, 'SENT'),
      sent24h: per(sent24, r.id),
      failed,
      dead,
      lastWebhookAt: hooks.find((w) => w.restaurantId === r.id)?._max.receivedAt ?? null,
      lastError: cred?.lastError ?? null,
    };
  });

  const attention = (r: ConsoleRow) => r.health === 'failing' || r.health === 'degraded';
  const view = opts.view ?? 'all';
  const rows =
    view === 'on' ? all.filter((r) => r.state === 'on')
      : view === 'attention' ? all.filter(attention)
        : view === 'not_set_up' ? all.filter((r) => r.state === 'not_set_up')
          : all;

  return {
    flagOn: novaryqFlagOn(),
    rows,
    total,
    truncated: total > restaurants.length,
    kpis: {
      restaurants: total,
      connected: all.filter((r) => r.state === 'on').length,
      needsAttention: all.filter(attention).length,
      sent24h: all.reduce((s, r) => s + r.sent24h, 0),
    },
  };
}
