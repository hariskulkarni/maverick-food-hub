'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, RefreshCw, MessageSquare, Mail, Smartphone, Bell, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';

type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'PUSH';
type Status  = 'QUEUED' | 'SENT' | 'FAILED';

interface LogRow {
  id: string;
  channel: Channel;
  status: Status;
  to: string;
  subject?: string | null;
  body: string;
  template?: string | null;
  error?: string | null;
  sentAt?: string | null;
  createdAt: string;
  user?: { id: string; name?: string | null; email?: string | null; phone?: string | null; role?: string } | null;
}

const CHANNEL_ICON: Record<Channel, any> = {
  SMS:      Smartphone,
  WHATSAPP: MessageSquare,
  EMAIL:    Mail,
  PUSH:     Bell
};

const CHANNELS: Array<Channel | 'ALL'> = ['ALL', 'SMS', 'WHATSAPP', 'EMAIL', 'PUSH'];
const STATUSES: Array<Status | 'ALL'>  = ['ALL', 'QUEUED', 'SENT', 'FAILED'];

export function NotificationsTable() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel | 'ALL'>('ALL');
  const [status, setStatus]   = useState<Status  | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (channel !== 'ALL') params.set('channel', channel);
    if (status  !== 'ALL') params.set('status',  status);
    if (q.trim()) params.set('q', q.trim());
    params.set('limit', '100');
    const r = await fetch(`/api/admin/notifications?${params.toString()}`, { cache: 'no-store' });
    if (r.ok) setRows(await r.json());
    setLoading(false);
  }, [channel, status, q]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { total: rows.length, sent: 0, failed: 0, queued: 0 } as any;
    rows.forEach((r) => { if (r.status === 'SENT') c.sent++; else if (r.status === 'FAILED') c.failed++; else c.queued++; });
    return c;
  }, [rows]);

  return (
    <div>
      {/* Toolbar */}
      <div className="p-4 border-b space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipient, subject, or body" className="pl-9 h-9" />
          </div>
          <div className="flex items-center gap-1 text-xs">
            {CHANNELS.map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${channel === c ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
              >
                {c === 'ALL' ? 'All channels' : c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${status === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
              >
                {s === 'ALL' ? 'All status' : s}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-auto">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{counts.total} entries</span>
          <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3" /> {counts.sent} sent</span>
          <span className="inline-flex items-center gap-1 text-warning"><Clock className="size-3" /> {counts.queued} queued</span>
          <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" /> {counts.failed} failed</span>
        </div>
      </div>

      {/* Table */}
      <div className="divide-y">
        {loading && rows.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">No notifications match these filters.</div>
        )}
        {rows.map((r) => {
          const Icon = CHANNEL_ICON[r.channel];
          const isOpen = expanded === r.id;
          return (
            <div key={r.id} className={isOpen ? 'bg-muted/30' : ''}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                className="w-full text-left p-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={`grid size-9 place-items-center rounded-lg shrink-0 ${
                    r.status === 'SENT' ? 'bg-success/15 text-success'
                    : r.status === 'FAILED' ? 'bg-destructive/15 text-destructive'
                    : 'bg-warning/15 text-warning'
                  }`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm truncate">{r.subject || r.template || channelLabel(r.channel)}</span>
                      <StatusBadge status={r.status} />
                      <Badge variant="muted">{r.channel}</Badge>
                      {r.user?.role && <Badge variant="outline" className="text-[10px]">{r.user.role}</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground truncate">
                      to <span className="font-mono">{r.to}</span>
                      {r.user?.name && <> · {r.user.name}</>}
                      <> · {formatRelative(r.createdAt)}</>
                    </div>
                    {!isOpen && <div className="mt-1.5 text-xs text-muted-foreground line-clamp-1">{r.body}</div>}
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pl-16 space-y-2 text-xs">
                  <div className="rounded-md bg-card border p-3 whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
                    {r.body}
                  </div>
                  <div className="grid gap-1 grid-cols-2 md:grid-cols-4 text-muted-foreground">
                    <Meta label="Template" value={r.template ?? '—'} />
                    <Meta label="Sent at" value={r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'} />
                    <Meta label="Queued at" value={new Date(r.createdAt).toLocaleString()} />
                    <Meta label="ID" value={r.id.slice(0, 12) + '…'} mono />
                  </div>
                  {r.error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-[12px]">
                      <strong>Error:</strong> {r.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'SENT')   return <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-0.5" /> Sent</Badge>;
  if (status === 'FAILED') return <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="size-3 mr-0.5" /> Failed</Badge>;
  return <Badge variant="warning" className="text-[10px]"><Clock className="size-3 mr-0.5" /> Queued</Badge>;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider opacity-60">{label}</div>
      <div className={mono ? 'font-mono' : ''}>{value}</div>
    </div>
  );
}

function channelLabel(c: Channel) {
  return c === 'SMS' ? 'Text message' : c === 'WHATSAPP' ? 'WhatsApp message' : c === 'EMAIL' ? 'Email' : 'Push notification';
}

function formatRelative(iso: string) {
  const d = new Date(iso).getTime();
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
