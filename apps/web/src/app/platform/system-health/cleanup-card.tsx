'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Trash2, Loader2, RefreshCw, HardDrive, CheckCircle2, ShieldCheck, AlertTriangle } from 'lucide-react';

interface Target { key: string; label: string; kind: string; path: string; bytes: number; cleared: boolean; note?: string }
interface Disk { totalBytes: number; usedBytes: number; freeBytes: number; usedPct: number }
interface Report { targets: Target[]; totalBytes: number; diskBefore: Disk | null; diskAfter: Disk | null; ranAt: string; dryRun: boolean }

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/**
 * Safe cleanup — clears the Next build cache, npm cache, and truncates pm2 logs
 * from the browser (super-admin only). Never touches images, the database, or
 * .env; see server/system-cleanup.ts. Two-tap confirm so a stray click can't
 * fire it.
 */
export function CleanupCard() {
  const [preview, setPreview] = useState<Report | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function loadPreview() {
    setLoading(true);
    try {
      const r = await fetch('/api/platform/system/cleanup', { cache: 'no-store' });
      if (!r.ok) throw new Error(await r.text());
      setPreview(await r.json());
    } catch (e: any) {
      toast.error('Could not read cleanup preview', { description: String(e?.message || e).slice(0, 160) });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadPreview(); }, []);

  async function run() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    setBusy(true);
    try {
      const r = await fetch('/api/platform/system/cleanup', { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      const rep: Report = await r.json();
      setResult(rep);
      toast.success(`Cleanup done — reclaimed ${fmtBytes(rep.totalBytes)}`);
      loadPreview();
    } catch (e: any) {
      toast.error('Cleanup failed', { description: String(e?.message || e).slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  const shown = result ?? preview;
  const disk = shown?.diskAfter ?? shown?.diskBefore ?? null;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><Trash2 className="size-4 text-primary" /> Safe cleanup</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-prose">
              Clears the Next.js build cache, npm cache, and app logs to reclaim disk.
              <span className="inline-flex items-center gap-1 ml-1 text-success"><ShieldCheck className="size-3.5" /> Never touches images, the database, or config.</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadPreview} disabled={loading || busy} title="Recompute reclaimable space">
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              size="sm"
              variant={confirming ? 'destructive' : 'default'}
              onClick={run}
              disabled={busy || loading}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {busy ? 'Cleaning…' : confirming ? 'Click again to confirm' : 'Run safe cleanup'}
            </Button>
          </div>
        </div>

        {disk && (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span className="inline-flex items-center gap-1.5"><HardDrive className="size-3.5" /> Disk usage</span>
              <span>{fmtBytes(disk.usedBytes)} / {fmtBytes(disk.totalBytes)} · {disk.usedPct.toFixed(0)}% used · {fmtBytes(disk.freeBytes)} free</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${disk.usedPct > 85 ? 'bg-destructive' : disk.usedPct > 70 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, disk.usedPct)}%` }} />
            </div>
          </div>
        )}

        <ul className="divide-y text-sm rounded-lg border">
          {(shown?.targets ?? []).map((t) => (
            <li key={t.key} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-1.5">
                  {result && t.cleared && <CheckCircle2 className="size-3.5 text-success shrink-0" />}
                  {t.label}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">{t.path}</div>
                {t.note && <div className="text-[11px] text-warning flex items-center gap-1 mt-0.5"><AlertTriangle className="size-3" /> {t.note}</div>}
              </div>
              <div className="text-right shrink-0 tabular-nums">
                <div className="font-semibold">{fmtBytes(t.bytes)}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{result ? (t.cleared ? 'freed' : 'skipped') : 'reclaimable'}</div>
              </div>
            </li>
          ))}
          {!loading && (shown?.targets?.length ?? 0) === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">Nothing to clean right now.</li>
          )}
        </ul>

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {result ? 'Last run reclaimed' : 'Total reclaimable'}
          </span>
          <span className="font-semibold">{fmtBytes(shown?.totalBytes ?? 0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
