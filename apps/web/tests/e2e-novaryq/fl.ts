/**
 * Adapter to FL's implementation (branch feat/novaryq-integration). The contract pins the webhook
 * path, the models and the cron route pattern; everything else FL names freely, so it is looked up
 * here and nowhere else. A missing export fails the calling test with a precise message rather
 * than being skipped.
 */
const INTERNAL_SECRET = 'qa-internal-cron-secret';
process.env.INTERNAL_CRON_SECRET ??= INTERNAL_SECRET;

type Mod = Record<string, any>;

async function load(path: string): Promise<Mod> {
  return import(/* @vite-ignore */ path);
}

function pick(mod: Mod, names: string[], what: string): (...a: any[]) => any {
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  throw new Error(`FL surface missing: ${what} (looked for ${names.join(' | ')}; module exports: ${Object.keys(mod).join(', ')})`);
}

export const fl = {
  /** POST /api/integrations/novaryq/webhook/[restaurantId] (CONTRACT §5, fixed path). */
  async webhookPOST(req: Request, restaurantId: string): Promise<Response> {
    const m = await load('@/app/api/integrations/novaryq/webhook/[restaurantId]/route');
    return m.POST(req as any, { params: Promise.resolve({ restaurantId }) });
  },

  /** The cron job route (CONTRACT §5: POST-only, constant-time INTERNAL_CRON_SECRET). */
  async workerRoute(headers: Record<string, string> = { 'x-internal-secret': process.env.INTERNAL_CRON_SECRET! }, method = 'POST'): Promise<Response> {
    const m = await load('@/app/api/platform/jobs/novaryq-worker/run/route');
    const handler = m[method];
    if (typeof handler !== 'function') return new Response(null, { status: 405 });
    return handler(new Request('http://flavrly.test/api/platform/jobs/novaryq-worker/run', { method, headers }) as any);
  },

  /** The fallback job (CONTRACT §5 periodic reconcile): POST /api/platform/jobs/novaryq-reconcile/run. */
  async runReconcileJob(): Promise<any> {
    const m = await load('@/app/api/platform/jobs/novaryq-reconcile/run/route');
    const res: Response = await m.POST(new Request('http://flavrly.test/api/platform/jobs/novaryq-reconcile/run', { method: 'POST', headers: { 'x-internal-secret': process.env.INTERNAL_CRON_SECRET! } }) as any);
    if (res.status !== 200) throw new Error(`novaryq-reconcile returned ${res.status}: ${await res.text()}`);
    return res.json();
  },

  async runWorker(): Promise<any> {
    const res = await fl.workerRoute();
    if (res.status !== 200) throw new Error(`novaryq-worker returned ${res.status}: ${await res.text()}`);
    return res.json();
  },

  /** FL's server modules merged (src/server/novaryq/{push,menu,status,webhook}.ts, or an index). */
  async server(): Promise<Mod> {
    const out: Mod = {};
    for (const p of ['@/server/novaryq/push', '@/server/novaryq/menu', '@/server/novaryq/status', '@/server/novaryq/webhook', '@/server/novaryq']) {
      try {
        Object.assign(out, await load(p));
      } catch {
        /* module not present in this layout */
      }
    }
    return out;
  },

  async importMenu(restaurantId: string, branchId: string, actorId?: string) {
    const f = pick(await fl.server(), ['importMenu', 'importNovaryqMenu', 'importMenuFromNovaryq'], 'menu import');
    return f(restaurantId, branchId, actorId);
  },

  /** Admin replay of a FAILED/DEAD sync. Throws when FL reports { ok:false } so tests see why. */
  async replay(restaurantId: string, syncId: string, actorId: string) {
    const f = pick(await fl.server(), ['replaySync', 'replayOrderSync', 'replayNovaryqSync'], 'manual replay');
    const r = await f(restaurantId, syncId, actorId);
    if (r && r.ok === false) throw new Error(`replay refused: ${r.error}`);
    return r;
  },

  /** Periodic menu + availability reconcile (fallback for missed webhooks). */
  async reconcile(restaurantId: string) {
    const f = pick(await fl.server(), ['reconcileMenu', 'reconcileAvailability', 'reconcileRestaurant', 'runReconcile'], 'menu/availability reconcile');
    return f(restaurantId);
  },

  async checkBaseUrl(url: string, resolve?: (h: string) => Promise<string[]>): Promise<string | null> {
    const m = await load('@/server/novaryq/client');
    return pick(m, ['checkBaseUrl'], 'baseUrl SSRF guard')(url, resolve ? { resolve } : {});
  },
};
