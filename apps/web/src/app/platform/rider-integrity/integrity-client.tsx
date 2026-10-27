'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, Smartphone, MapPinOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatIst } from '@/lib/ist';
import { reportApiError } from '@/lib/api-error';

interface QueueRow {
  riderId: string;
  name: string | null;
  phone: string | null;
  isOnline: boolean;
  locationSuspect: boolean;
  offersPaused: boolean;
  status: string;
  mockPingCount: number;
  spoofScore: number;
  verdict: string;
  flaggedAt: string | null;
  flaggedReason: string | null;
  lastSpoofAt: string | null;
  reviewedAt: string | null;
  recentKinds: string[];
}
interface Config {
  mockPingThreshold: number;
  autoPauseOffers: boolean;
  gateOnlineOnFailed: boolean;
}

const ist = (iso: string | null) => (iso ? formatIst(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const VERDICT_LABEL: Record<string, string> = {
  MEETS_DEVICE_INTEGRITY: 'Device integrity OK',
  MEETS_BASIC_INTEGRITY: 'Basic integrity only',
  FAILED: 'Integrity FAILED',
  UNEVALUATED: 'Not evaluated',
};

export function RiderIntegrityClient({ canWrite }: { canWrite: boolean }) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/platform/rider-integrity', { cache: 'no-store' });
      if (!res.ok) {
        await reportApiError(res, 'Could not load the review queue');
        return;
      }
      const body = (await res.json()) as { queue: QueueRow[]; config: Config };
      setQueue(body.queue);
      setConfig(body.config);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (riderId: string, action: 'clear' | 'keep' | 'pause' | 'resume') => {
      setBusy(`${riderId}:${action}`);
      try {
        const res = await fetch('/api/platform/rider-integrity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ riderId, action }),
        });
        if (!res.ok) {
          await reportApiError(res, 'Action failed');
          return;
        }
        toast.success(
          action === 'clear' ? 'Rider cleared' : action === 'pause' ? 'Offers paused' : action === 'resume' ? 'Offers resumed' : 'Kept flagged',
        );
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const saveConfig = useCallback(async () => {
    if (!config) return;
    setSavingCfg(true);
    try {
      const res = await fetch('/api/platform/rider-integrity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        await reportApiError(res, 'Could not save policy');
        return;
      }
      setConfig((await res.json()) as Config);
      toast.success('Anti-fraud policy saved');
    } finally {
      setSavingCfg(false);
    }
  }, [config]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldAlert className="h-5 w-5 text-primary" /> Location integrity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Riders flagged for fake/mock GPS or failed device integrity. Fraud prevention on operational location only.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </header>

      {/* Policy */}
      {config && (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <h2 className="text-sm font-semibold">Anti-fraud policy</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="threshold">Mock-GPS pings per shift before flagging</Label>
                <Input
                  id="threshold"
                  type="number"
                  min={1}
                  max={100}
                  value={config.mockPingThreshold}
                  disabled={!canWrite}
                  onChange={(e) => setConfig({ ...config, mockPingThreshold: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>
              <label className="flex items-start gap-3">
                <Switch
                  checked={config.autoPauseOffers}
                  disabled={!canWrite}
                  onCheckedChange={(v) => setConfig({ ...config, autoPauseOffers: v })}
                />
                <span className="text-sm">
                  <span className="font-medium">Auto-pause offers</span>
                  <br />
                  <span className="text-muted-foreground">Stop new order offers to a flagged rider until reviewed.</span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <Switch
                  checked={config.gateOnlineOnFailed}
                  disabled={!canWrite}
                  onCheckedChange={(v) => setConfig({ ...config, gateOnlineOnFailed: v })}
                />
                <span className="text-sm">
                  <span className="font-medium">Gate going online</span>
                  <br />
                  <span className="text-muted-foreground">Block going online on a FAILED device-integrity verdict.</span>
                </span>
              </label>
            </div>
            {canWrite && (
              <div>
                <Button size="sm" onClick={() => void saveConfig()} disabled={savingCfg}>
                  {savingCfg ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save policy
                </Button>
                <span className="ml-3 text-xs text-muted-foreground">Both enforcement actions default OFF — a suspect rider is always flagged, never silently blocked.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Queue */}
      {loading ? (
        <div className="grid place-items-center py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : queue.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center gap-2 py-16 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No riders flagged for location integrity.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((r) => (
            <Card key={r.riderId}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/platform/riders/${r.riderId}/insights`} className="font-medium hover:underline">
                        {r.name ?? 'Rider'}
                      </Link>
                      {r.isOnline && <Badge variant="secondary">Online</Badge>}
                      <Badge variant={r.status === 'FLAGGED' ? 'destructive' : r.status === 'CLEARED' ? 'secondary' : 'outline'}>
                        {r.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.phone ?? '—'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className="gap-1">
                      <MapPinOff className="h-3 w-3" /> {r.mockPingCount} mock pings
                    </Badge>
                    <Badge variant="outline">score {r.spoofScore}</Badge>
                    <Badge variant={r.verdict === 'FAILED' ? 'destructive' : 'outline'} className="gap-1">
                      <Smartphone className="h-3 w-3" /> {VERDICT_LABEL[r.verdict] ?? r.verdict}
                    </Badge>
                    {r.offersPaused && <Badge variant="destructive">Offers paused</Badge>}
                  </div>
                </div>

                {r.flaggedReason && <p className="text-sm">{r.flaggedReason}</p>}
                <p className="text-xs text-muted-foreground">
                  Flagged {ist(r.flaggedAt)} · last incident {ist(r.lastSpoofAt)}
                  {r.recentKinds.length > 0 && <> · recent: {r.recentKinds.join(', ')}</>}
                  {r.reviewedAt && <> · reviewed {ist(r.reviewedAt)}</>}
                </p>

                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void act(r.riderId, 'clear')} disabled={!!busy}>
                      Clear
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void act(r.riderId, 'keep')} disabled={!!busy}>
                      Keep flagged
                    </Button>
                    {r.offersPaused ? (
                      <Button size="sm" variant="outline" onClick={() => void act(r.riderId, 'resume')} disabled={!!busy}>
                        Resume offers
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => void act(r.riderId, 'pause')} disabled={!!busy}>
                        Pause offers
                      </Button>
                    )}
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/platform/riders/${r.riderId}/insights`}>View insights</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
