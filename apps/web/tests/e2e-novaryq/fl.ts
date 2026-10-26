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

  async runWorker(): Promise<any> {
    const res = await fl.workerRoute();
    if (res.status !== 200) throw new Error(`novaryq-worker returned ${res.status}: ${await res.text()}`);
    return res.json();
  },

  async server(): Promise<Mod> {
    return load('@/server/novaryq');
  },

  async importMenu(restaurantId: string, branchId: string, actorId?: string) {
    const f = pick(await fl.server(), ['importMenu', 'importNovaryqMenu', 'importMenuFromNovaryq'], 'menu import');
    return f(restaurantId, branchId, actorId);
  },

  async replay(syncId: string, actorId?: string) {
    const f = pick(await fl.server(), ['replayOrderSync', 'replaySync', 'replayNovaryqSync', 'manualReplay'], 'manual replay');
    return f(syncId, actorId);
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
