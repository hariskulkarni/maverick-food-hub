/**
 * Platform → System health.
 *
 * Single-shot snapshot of the deployment, intended to be the first place an
 * operator checks when something feels off. Read-only, no destructive actions.
 */
import { promises as fs } from 'node:fs';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { deploymentSummary } from '@/server/feature-flags';
import { CleanupCard } from './cleanup-card';
import {
  Activity, Database, AlertTriangle, HardDrive, Server,
  MessageSquare, Mail, CreditCard, CheckCircle2, XCircle, Clock
} from 'lucide-react';

export const metadata = { title: 'Platform · System health' };
export const dynamic = 'force-dynamic';

interface IntegrationHealthRow {
  provider: string;
  count: number;
  connected: number;
  failed: number;
  lastTestedAt: Date | null;
  lastError: string | null;
}

async function probeDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const t0 = Date.now();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function readLastBackup(): Promise<string | null> {
  const path = process.env.LAST_BACKUP_MARKER;
  if (!path) return null;
  try {
    const txt = (await fs.readFile(path, 'utf8')).trim();
    return txt || null;
  } catch {
    return null;
  }
}

async function integrationHealth(): Promise<IntegrationHealthRow[]> {
  // Bucket integrations by provider so we can show one row per kind.
  const rows = await prisma.integrationCredential.findMany({
    select: { provider: true, status: true, lastTestedAt: true, lastError: true }
  });
  const byProvider = new Map<string, IntegrationHealthRow>();
  for (const r of rows) {
    const key = String(r.provider);
    const row = byProvider.get(key) ?? {
      provider: key, count: 0, connected: 0, failed: 0, lastTestedAt: null, lastError: null
    };
    row.count += 1;
    if (r.status === 'CONNECTED') row.connected += 1;
    if (r.status === 'FAILED') row.failed += 1;
    if (r.lastTestedAt && (!row.lastTestedAt || r.lastTestedAt > row.lastTestedAt)) {
      row.lastTestedAt = r.lastTestedAt;
    }
    if (r.status === 'FAILED' && r.lastError && !row.lastError) row.lastError = r.lastError;
    byProvider.set(key, row);
  }
  return Array.from(byProvider.values()).sort((a, b) => a.provider.localeCompare(b.provider));
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(d: Date | null): string {
  if (!d) return 'never';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function SystemHealthPage() {
  const [db, recentErrors, integrations, lastBackup] = await Promise.all([
    probeDb(),
    prisma.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    integrationHealth(),
    readLastBackup()
  ]);

  const summary = deploymentSummary();
  const uptime = process.uptime();
  const nodeVersion = process.version;
  const mem = process.memoryUsage();

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="display text-3xl font-semibold">System health</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live snapshot of the platform's plumbing — database, integrations, recent errors, deployment mode.
          </p>
        </div>
        <div className="text-xs text-muted-foreground text-right">
          <div>{new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          <div className="mt-0.5 font-medium">{summary.deploymentMode}</div>
        </div>
      </header>

      {/* Top status grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          icon={Database}
          label="Database"
          status={db.ok ? 'ok' : 'fail'}
          primary={db.ok ? `${db.latencyMs} ms` : 'unreachable'}
          sub={db.ok ? 'SELECT 1 round-trip' : db.error ?? 'unknown error'}
        />
        <StatusCard
          icon={Server}
          label="Process"
          status="ok"
          primary={`up ${formatUptime(uptime)}`}
          sub={`Node ${nodeVersion} · ${(mem.rss / 1024 / 1024).toFixed(0)} MB RSS`}
        />
        <StatusCard
          icon={HardDrive}
          label="Last backup"
          status={lastBackup ? 'ok' : 'warn'}
          primary={lastBackup ? new Date(lastBackup).toLocaleString('en-IN') : 'unknown'}
          sub={lastBackup ? timeAgo(new Date(lastBackup)) : 'LAST_BACKUP_MARKER not set'}
        />
        <StatusCard
          icon={Activity}
          label="Recent errors"
          status={recentErrors.length === 0 ? 'ok' : recentErrors.length > 10 ? 'warn' : 'ok'}
          primary={`${recentErrors.length}`}
          sub="in the last 20 log rows"
        />
      </div>

      {/* Deployment summary */}
      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><Server className="size-4 text-primary" /> Deployment</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
            <KV k="Phase" v={summary.phase} />
            <KV k="Deployment mode" v={summary.deploymentMode} />
            <KV k="Storage provider" v={summary.storageProvider} />
            <KV k="SMS provider" v={summary.smsProvider} />
            <KV k="Email provider" v={summary.emailProvider} />
            <KV k="Enabled flags" v={summary.enabledFlags.length > 0 ? summary.enabledFlags.join(', ') : 'none (lean defaults)'} />
          </dl>
        </CardContent>
      </Card>

      {/* Maintenance — safe disk cleanup */}
      <CleanupCard />

      {/* Integration health */}
      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><CreditCard className="size-4 text-primary" /> Integration health</h2>
          {integrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tenant has configured any integration yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Provider</th>
                    <th className="py-2 pr-3">Tenants</th>
                    <th className="py-2 pr-3">Connected</th>
                    <th className="py-2 pr-3">Failed</th>
                    <th className="py-2 pr-3">Last tested</th>
                    <th className="py-2 pr-3">Last error</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {integrations.map((r: IntegrationHealthRow) => (
                    <tr key={r.provider}>
                      <td className="py-2 pr-3 font-medium flex items-center gap-2">
                        {iconFor(r.provider)} {r.provider}
                      </td>
                      <td className="py-2 pr-3">{r.count}</td>
                      <td className="py-2 pr-3"><Badge className="bg-success/15 text-success border-success/30">{r.connected}</Badge></td>
                      <td className="py-2 pr-3">{r.failed > 0
                        ? <Badge className="bg-destructive/15 text-destructive border-destructive/30">{r.failed}</Badge>
                        : <span className="text-muted-foreground">0</span>}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{timeAgo(r.lastTestedAt)}</td>
                      <td className="py-2 pr-3 text-xs text-destructive truncate max-w-[280px]">{r.lastError ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent errors */}
      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><AlertTriangle className="size-4 text-warning" /> Recent errors</h2>
          {recentErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No errors logged. Beautiful.</p>
          ) : (
            <ul className="divide-y text-sm">
              {recentErrors.map((e: any) => (
                <li key={e.id} className="py-2 flex items-start gap-3">
                  <Badge className={
                    e.level === 'error' ? 'bg-destructive/15 text-destructive border-destructive/30 shrink-0'
                    : e.level === 'warn' ? 'bg-warning/15 text-warning border-warning/30 shrink-0'
                    : 'bg-muted shrink-0'
                  }>{e.level}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-muted-foreground">{e.source}</div>
                    <div className="truncate">{e.message}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                    <Clock className="size-3" />{timeAgo(e.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function StatusCard({
  icon: Icon, label, status, primary, sub
}: {
  icon: any; label: string; status: 'ok' | 'warn' | 'fail'; primary: string; sub: string;
}) {
  const tone = status === 'ok' ? 'border-success/30 bg-success/5'
    : status === 'warn' ? 'border-warning/30 bg-warning/5'
    : 'border-destructive/30 bg-destructive/5';
  const dot = status === 'ok' ? <CheckCircle2 className="size-4 text-success" />
    : status === 'warn' ? <AlertTriangle className="size-4 text-warning" />
    : <XCircle className="size-4 text-destructive" />;
  return (
    <Card className={tone}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className="size-4" /> {label} {dot}
        </div>
        <div className="text-xl font-bold mt-1">{primary}</div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>
      </CardContent>
    </Card>
  );
}

function iconFor(provider: string) {
  if (provider === 'RAZORPAY') return <CreditCard className="size-4 text-muted-foreground" />;
  if (provider.includes('SMTP') || provider === 'SMTP') return <Mail className="size-4 text-muted-foreground" />;
  if (provider === 'S3') return <HardDrive className="size-4 text-muted-foreground" />;
  return <MessageSquare className="size-4 text-muted-foreground" />;
}
