/**
 * Observability probes — the active health checks. Each probe is independent and
 * defensive (never throws); `runAllProbes()` runs them and records results.
 *
 * All checks are local/self-contained: a SELECT 1 against the DB, OS metrics,
 * a TLS handshake to read the cert (only when serving over https), a DNS lookup,
 * and config-presence checks for third-party integrations (no outbound calls to
 * those providers, so there's no egress dependency or cost).
 */
import os from 'node:os';
import fs from 'node:fs';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import { prisma } from '../db';
import { recordProbe, pruneProbeHistory, type ObsStatus } from './store';

function siteHost(): { host: string; isHttps: boolean } {
  try {
    const u = new URL(process.env.NEXTAUTH_URL || '');
    return { host: u.hostname, isHttps: u.protocol === 'https:' };
  } catch {
    return { host: '', isHttps: false };
  }
}

async function probeDatabase(): Promise<void> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    await recordProbe({
      target: 'db',
      category: 'DATABASE',
      label: 'PostgreSQL',
      status: latencyMs > 1000 ? 'DEGRADED' : 'UP',
      latencyMs,
      detail: latencyMs > 1000 ? `Slow response (${latencyMs}ms)` : `Responding in ${latencyMs}ms`,
    });
  } catch (e) {
    await recordProbe({
      target: 'db',
      category: 'DATABASE',
      label: 'PostgreSQL',
      status: 'DOWN',
      latencyMs: Date.now() - t0,
      detail: (e as Error).message?.slice(0, 200) ?? 'Query failed',
    });
  }
}

async function probeSystem(): Promise<void> {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const cpus = os.cpus()?.length || 1;
    const load1 = os.loadavg()[0] ?? 0;
    const loadPerCpu = load1 / cpus;

    // Disk (Node 18.15+: fs.statfsSync). Fall back gracefully if unavailable.
    let diskPct: number | null = null;
    try {
      const st = (fs as unknown as { statfsSync?: (p: string) => { blocks: number; bavail: number; bfree: number } }).statfsSync?.('/');
      if (st && st.blocks > 0) diskPct = Math.round(((st.blocks - st.bfree) / st.blocks) * 100);
    } catch {
      /* statfs unsupported */
    }

    let status: ObsStatus = 'UP';
    const flags: string[] = [];
    if (usedPct >= 92) { status = 'DEGRADED'; flags.push(`memory ${usedPct}%`); }
    if (loadPerCpu >= 1.5) { status = 'DEGRADED'; flags.push(`load ${load1.toFixed(2)}/${cpus}cpu`); }
    if (diskPct !== null && diskPct >= 90) { status = 'DEGRADED'; flags.push(`disk ${diskPct}%`); }
    if (usedPct >= 98 || (diskPct !== null && diskPct >= 97)) status = 'DOWN';

    await recordProbe({
      target: 'system',
      category: 'SYSTEM',
      label: 'Server (CPU / memory / disk)',
      status,
      detail: flags.length ? `Pressure: ${flags.join(', ')}` : `mem ${usedPct}% · load ${load1.toFixed(2)} · ${cpus} CPU`,
      meta: {
        memoryUsedPct: usedPct,
        totalMemMB: Math.round(totalMem / 1048576),
        freeMemMB: Math.round(freeMem / 1048576),
        cpuCount: cpus,
        load1: Number(load1.toFixed(2)),
        load5: Number((os.loadavg()[1] ?? 0).toFixed(2)),
        load15: Number((os.loadavg()[2] ?? 0).toFixed(2)),
        diskUsedPct: diskPct,
        osUptimeSec: Math.round(os.uptime()),
      },
    });
  } catch (e) {
    await recordProbe({ target: 'system', category: 'SYSTEM', label: 'Server (CPU / memory / disk)', status: 'UNKNOWN', detail: (e as Error).message?.slice(0, 200) });
  }
}

async function probeApp(): Promise<void> {
  try {
    const mem = process.memoryUsage();
    await recordProbe({
      target: 'app',
      category: 'APP',
      label: 'Web app process',
      status: 'UP',
      detail: `Up ${Math.round(process.uptime())}s · RSS ${Math.round(mem.rss / 1048576)}MB · Node ${process.version}`,
      meta: {
        processUptimeSec: Math.round(process.uptime()),
        rssMB: Math.round(mem.rss / 1048576),
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
        nodeVersion: process.version,
        nextRuntime: process.env.NEXT_RUNTIME ?? 'nodejs',
      },
    });
  } catch {
    /* ignore */
  }
}

async function probeSslAndDomain(): Promise<void> {
  const { host, isHttps } = siteHost();

  // ── DNS / domain resolution ──
  if (!host) {
    await recordProbe({ target: 'dns', category: 'DOMAIN', label: 'Domain / DNS', status: 'UNKNOWN', detail: 'NEXTAUTH_URL not set' });
  } else {
    try {
      const res = await dns.lookup(host);
      await recordProbe({ target: 'dns', category: 'DOMAIN', label: 'Domain / DNS', status: 'UP', detail: `${host} → ${res.address}`, meta: { host, address: res.address } });
    } catch (e) {
      await recordProbe({ target: 'dns', category: 'DOMAIN', label: 'Domain / DNS', status: 'DOWN', detail: `Cannot resolve ${host}: ${(e as Error).message?.slice(0, 120)}` });
    }
  }

  // ── SSL certificate ──
  if (!host) {
    await recordProbe({ target: 'ssl', category: 'SSL', label: 'TLS certificate', status: 'UNKNOWN', detail: 'No host configured' });
    return;
  }
  if (!isHttps) {
    await recordProbe({
      target: 'ssl',
      category: 'SSL',
      label: 'TLS certificate',
      status: 'UNKNOWN',
      detail: 'Site is served over HTTP — no TLS certificate yet. Add a domain + HTTPS to enable.',
    });
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 5000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          void recordProbe({ target: 'ssl', category: 'SSL', label: 'TLS certificate', status: 'DOWN', detail: 'No certificate returned' }).finally(done);
          return;
        }
        const expiry = new Date(cert.valid_to);
        const daysLeft = Math.round((expiry.getTime() - Date.now()) / 86400000);
        const status: ObsStatus = daysLeft <= 0 ? 'DOWN' : daysLeft <= 14 ? 'DEGRADED' : 'UP';
        void recordProbe({
          target: 'ssl',
          category: 'SSL',
          label: 'TLS certificate',
          status,
          detail: daysLeft <= 0 ? 'Certificate EXPIRED' : `Valid — ${daysLeft} day(s) left`,
          meta: { issuer: cert.issuer?.O ?? null, validTo: cert.valid_to, daysLeft },
        }).finally(done);
      });
      socket.on('timeout', () => { socket.destroy(); void recordProbe({ target: 'ssl', category: 'SSL', label: 'TLS certificate', status: 'DOWN', detail: 'TLS handshake timed out' }).finally(done); });
      socket.on('error', (err) => { void recordProbe({ target: 'ssl', category: 'SSL', label: 'TLS certificate', status: 'DOWN', detail: err.message?.slice(0, 160) }).finally(done); });
    } catch (e) {
      void recordProbe({ target: 'ssl', category: 'SSL', label: 'TLS certificate', status: 'DOWN', detail: (e as Error).message?.slice(0, 160) }).finally(done);
    }
  });
}

async function probeIntegrations(): Promise<void> {
  const checks: Array<{ target: string; label: string; configured: boolean; note: string }> = [
    {
      target: 'integration:razorpay',
      label: 'Razorpay (payments)',
      configured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      note: process.env.RAZORPAY_WEBHOOK_SECRET ? 'Keys + webhook secret set' : 'Keys set, webhook secret MISSING',
    },
    {
      target: 'integration:sms',
      label: 'SMS / OTP gateway',
      configured: (process.env.NOTIFIER_SMS ?? 'mock').toLowerCase() !== 'mock',
      note: (process.env.NOTIFIER_SMS ?? 'mock').toLowerCase() === 'mock' ? 'Demo mode (mock) — no real SMS' : `Provider: ${process.env.NOTIFIER_SMS}`,
    },
    {
      target: 'integration:maps',
      label: 'Google Maps',
      configured: !!process.env.GOOGLE_MAPS_API_KEY,
      note: process.env.GOOGLE_MAPS_API_KEY ? 'API key set' : 'No API key (OSM/Leaflet fallback in use)',
    },
    {
      target: 'integration:storage',
      label: 'File storage',
      configured: (process.env.STORAGE_DRIVER ?? 'local') !== 'local',
      note: (process.env.STORAGE_DRIVER ?? 'local') === 'local' ? 'Local disk storage' : `Driver: ${process.env.STORAGE_DRIVER}`,
    },
    {
      target: 'integration:encryption',
      label: 'Integration secret encryption',
      configured: !!process.env.INTEGRATION_ENCRYPTION_KEY,
      note: process.env.INTEGRATION_ENCRYPTION_KEY ? 'Dedicated key set' : 'No dedicated key (dev fallback)',
    },
  ];
  for (const c of checks) {
    await recordProbe({
      target: c.target,
      category: 'INTEGRATION',
      label: c.label,
      // Config presence is informational: UP when fully configured, DEGRADED when
      // using a fallback/mock, never hard-DOWN (these aren't outages by themselves).
      status: c.configured ? 'UP' : 'DEGRADED',
      detail: c.note,
    });
  }
}

async function probeRealtime(): Promise<void> {
  try {
    const { bus } = await import('../realtime');
    // eventNames() reflects channels with active SSE subscribers in this process.
    const channels = bus.eventNames().length;
    await recordProbe({
      target: 'realtime',
      category: 'REALTIME',
      label: 'Realtime bus (SSE)',
      status: 'UP',
      detail: `${channels} active channel(s) in-process`,
      meta: { activeChannels: channels },
    });
  } catch (e) {
    await recordProbe({ target: 'realtime', category: 'REALTIME', label: 'Realtime bus (SSE)', status: 'UNKNOWN', detail: (e as Error).message?.slice(0, 160) });
  }
}

/** Run every probe. Independent + defensive — one failure never blocks the rest. */
export async function runAllProbes(): Promise<void> {
  await Promise.allSettled([
    probeDatabase(),
    probeSystem(),
    probeApp(),
    probeSslAndDomain(),
    probeIntegrations(),
    probeRealtime(),
  ]);
  // Keep history bounded (cheap, best-effort).
  await pruneProbeHistory(7);
}
