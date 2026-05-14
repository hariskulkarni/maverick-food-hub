'use client';
/**
 * Rider Safety — client side. Read-only.
 *
 *   • SOS alerts — ACTIVE ones rendered in urgent red; recently resolved
 *     ones shown muted for context.
 *   • Incident reports — OPEN / UNDER_REVIEW reports for dedicated riders.
 *   • A "Refresh" button re-pulls /api/admin/rider-safety so a restaurant
 *     watching this page sees new alerts without a full reload.
 *   • Empty state when everything's clear.
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ShieldCheck,
  Siren,
  AlertTriangle,
  MapPin,
  Phone,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

interface RiderRef {
  name: string | null;
  phone: string | null;
}
interface SosAlert {
  id: string;
  rider: RiderRef;
  status: 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
  lat: number | null;
  lng: number | null;
  note: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
}
interface Incident {
  id: string;
  rider: RiderRef;
  type: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
  description: string;
  createdAt: string;
}

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}
function titleCase(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RiderSafetyClient({
  initialSos,
  initialIncidents,
  riderCount
}: {
  initialSos: SosAlert[];
  initialIncidents: Incident[];
  riderCount: number;
}) {
  const [sos, setSos] = useState<SosAlert[]>(initialSos);
  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await fetch('/api/admin/rider-safety', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setSos(j.sosAlerts ?? []);
      setIncidents(j.incidents ?? []);
    } catch (e: any) {
      toast.error('Failed to refresh', { description: e?.message });
    } finally {
      setRefreshing(false);
    }
  }

  const activeSos = sos.filter((a) => a.status === 'ACTIVE');
  const pastSos = sos.filter((a) => a.status !== 'ACTIVE');
  const allClear = activeSos.length === 0 && pastSos.length === 0 && incidents.length === 0;

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-3">
        <SummaryPill
          tone={activeSos.length > 0 ? 'danger' : 'ok'}
          icon={<Siren className="size-4" />}
          label="Active SOS"
          value={activeSos.length}
        />
        <SummaryPill
          tone={incidents.length > 0 ? 'warn' : 'ok'}
          icon={<AlertTriangle className="size-4" />}
          label="Open incidents"
          value={incidents.length}
        />
        <SummaryPill
          tone="neutral"
          icon={<ShieldCheck className="size-4" />}
          label="Dedicated riders"
          value={riderCount}
        />
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="ml-auto">
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {allClear && riderCount > 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="All clear"
          description="No active SOS alerts or open incident reports for your dedicated riders."
        />
      )}

      {riderCount === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title="No dedicated riders"
          description="Once you dedicate riders to your restaurant, their safety alerts will appear here."
        />
      )}

      {/* Active SOS — urgent */}
      {activeSos.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            icon={Siren}
            tone="danger"
            title={`Active SOS alerts (${activeSos.length})`}
            subtitle="A rider has triggered an emergency alert and needs help right now."
          />
          <div className="space-y-3">
            {activeSos.map((a) => (
              <Card key={a.id} className="border-destructive/50 bg-destructive/5">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Siren className="size-4 text-destructive" />
                        <span className="font-semibold text-destructive">SOS — {a.rider.name ?? 'Rider'}</span>
                        <Badge variant="destructive">ACTIVE</Badge>
                      </div>
                      {a.note && <p className="text-sm">{a.note}</p>}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-0.5">
                        {a.rider.phone && (
                          <a
                            href={`tel:${a.rider.phone}`}
                            className="inline-flex items-center gap-1 text-foreground hover:underline"
                          >
                            <Phone className="size-3.5" />
                            {a.rider.phone}
                          </a>
                        )}
                        {a.lat != null && a.lng != null && (
                          <a
                            href={`https://maps.google.com/?q=${a.lat},${a.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <MapPin className="size-3.5" />
                            {a.lat.toFixed(4)}, {a.lng.toFixed(4)}
                          </a>
                        )}
                        <span>Triggered {fmt(a.triggeredAt)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Recently resolved SOS — context */}
      {pastSos.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            icon={Siren}
            tone="muted"
            title={`Recently resolved SOS (${pastSos.length})`}
            subtitle="SOS alerts from your riders closed in the last 24 hours."
          />
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <Th>Rider</Th>
                      <Th>Status</Th>
                      <Th>Note</Th>
                      <Th>Triggered</Th>
                      <Th>Resolved</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pastSos.map((a) => (
                      <tr key={a.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{a.rider.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={a.status === 'RESOLVED' ? 'success' : 'muted'}>{a.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[260px]">
                          <span className="line-clamp-2">{a.note ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {fmt(a.triggeredAt)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {a.resolvedAt ? fmt(a.resolvedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Open incident reports */}
      {incidents.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            icon={AlertTriangle}
            tone="warn"
            title={`Open incident reports (${incidents.length})`}
            subtitle="Incidents reported by your dedicated riders that are still being worked."
          />
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <Th>Rider</Th>
                      <Th>Type</Th>
                      <Th>Status</Th>
                      <Th>Description</Th>
                      <Th>Reported</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {incidents.map((i) => (
                      <tr key={i.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{i.rider.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant="warning">{titleCase(i.type)}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={i.status === 'UNDER_REVIEW' ? 'default' : 'muted'}>
                            {titleCase(i.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[320px]">
                          <span className="line-clamp-2">{i.description}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {fmt(i.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────── bits ─────────────────────────── */

function SummaryPill({
  tone,
  icon,
  label,
  value
}: {
  tone: 'danger' | 'warn' | 'ok' | 'neutral';
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const toneCls =
    tone === 'danger'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : tone === 'warn'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : tone === 'ok'
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground';
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${toneCls}`}>
      {icon}
      <span className="text-sm font-medium">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  tone = 'default'
}: {
  icon: any;
  title: string;
  subtitle?: string;
  tone?: 'default' | 'danger' | 'warn' | 'muted';
}) {
  const iconCls =
    tone === 'danger'
      ? 'bg-destructive/10 text-destructive'
      : tone === 'warn'
        ? 'bg-warning/10 text-warning'
        : tone === 'muted'
          ? 'bg-muted text-muted-foreground'
          : 'bg-primary/10 text-primary';
  return (
    <div className="flex items-center gap-3">
      <div className={`grid size-9 place-items-center rounded-lg ${iconCls}`}>
        <Icon className="size-5" />
      </div>
      <div>
        <h2 className="display text-xl font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}
