'use client';
/**
 * Super-admin KYC review queue.
 *   – KPI strip, filter bar (URL-synced), sortable table, slide-out review drawer
 *   – Auto-refresh every 30s while tab is visible
 *   – Inline image/PDF preview, approve/reject/expire flows
 *   – Optional bulk-approve for selected pending rows
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { fmtDate, relTime } from '@/lib/utils';
import {
  Search, X, RefreshCw, Download, Radar, Loader2, Check, AlertTriangle, FileText,
  IdCard, Car, ShieldCheck, FileSpreadsheet, CreditCard, ExternalLink, ArrowUpDown, BadgeCheck
} from 'lucide-react';

type DocType = 'AADHAAR' | 'DL' | 'INSURANCE' | 'RC' | 'PAN';
type DocStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

type KycDoc = {
  id: string;
  rider: { id: string; name: string | null; phone: string | null };
  type: DocType;
  status: DocStatus;
  numberLast4: string | null;
  fileUrl: string;
  fileName: string | null;
  fileMimeType: string;
  issuedOn?: string | null;
  expiresOn: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
};

type Counts = { PENDING: number; APPROVED: number; REJECTED: number; EXPIRED: number; EXPIRING_30D?: number };
type Filters = { status: string; type: string; q: string };

const STATUS_CHIPS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' }
];

const TYPE_OPTIONS: Array<{ value: DocType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'AADHAAR', label: 'Aadhaar' },
  { value: 'DL', label: 'Driving licence' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'RC', label: 'RC' },
  { value: 'PAN', label: 'PAN' }
];

const TYPE_ICON: Record<DocType, typeof IdCard> = {
  AADHAAR: IdCard,
  DL: Car,
  INSURANCE: ShieldCheck,
  RC: FileSpreadsheet,
  PAN: CreditCard
};

function maskNumber(type: DocType, last4: string | null): string {
  if (!last4) return '—';
  switch (type) {
    case 'AADHAAR':   return `XXXX XXXX ${last4}`;
    case 'PAN':       return `XXXXX${last4}`;
    case 'DL':        return `XX-XX-XXXX-${last4}`;
    case 'RC':        return `XX XX XXXX ${last4}`;
    case 'INSURANCE': return `••••${last4}`;
    default:          return `••••${last4}`;
  }
}

export function KycQueueClient({ filters }: { filters: Filters }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ]           = useState(filters.q);
  const [status, setStatus] = useState(filters.status);
  const [type, setType]     = useState(filters.type);
  const [sortAsc, setSortAsc] = useState(false);
  const [docs, setDocs]     = useState<KycDoc[]>([]);
  const [counts, setCounts] = useState<Counts>({ PENDING: 0, APPROVED: 0, REJECTED: 0, EXPIRED: 0 });
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const visibleRef = useRef(true);

  // Push filters → URL
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      ['q', 'status', 'type'].forEach((k) => sp.delete(k));
      if (q.trim()) sp.set('q', q.trim());
      if (status)   sp.set('status', status);
      if (type)     sp.set('type', type);
      router.replace(`/platform/kyc?${sp.toString()}`);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, type]);

  const load = useCallback(async () => {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (status) sp.set('status', status);
    if (type)   sp.set('type', type);
    if (q.trim()) sp.set('q', q.trim());
    const r = await fetch(`/api/platform/kyc?${sp.toString()}`, { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setDocs(j.documents ?? []);
      setCounts(j.counts ?? { PENDING: 0, APPROVED: 0, REJECTED: 0, EXPIRED: 0 });
    }
    setLoading(false);
  }, [status, type, q]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Poll every 30s, pause on tab blur
  useEffect(() => {
    function onVis() { visibleRef.current = !document.hidden; }
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(() => { if (visibleRef.current) load(); }, 30_000);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const sorted = useMemo(() => {
    const r = [...docs];
    r.sort((a, b) => {
      const ta = new Date(a.submittedAt).getTime();
      const tb = new Date(b.submittedAt).getTime();
      return sortAsc ? ta - tb : tb - ta;
    });
    return r;
  }, [docs, sortAsc]);

  const activeDoc = activeId ? docs.find((d) => d.id === activeId) ?? null : null;
  const pendingSelectedIds = useMemo(
    () => sorted.filter((d) => selected.has(d.id) && d.status === 'PENDING').map((d) => d.id),
    [sorted, selected]
  );

  function clearFilters() { setQ(''); setStatus(''); setType(''); }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function bulkApprove() {
    if (pendingSelectedIds.length === 0) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(
      pendingSelectedIds.map((id) =>
        fetch(`/api/platform/kyc/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' })
        })
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length;
    setBulkBusy(false);
    setSelected(new Set());
    toast.success(`Approved ${ok} of ${pendingSelectedIds.length}`);
    load();
  }

  function exportCsv() {
    const head = ['Submitted', 'Rider', 'Phone', 'Type', 'Status', 'Number', 'Expires', 'Reviewed by', 'Reviewed at', 'Rejection reason'];
    const rows = sorted.map((d) => [
      new Date(d.submittedAt).toISOString(),
      d.rider.name ?? '',
      d.rider.phone ?? '',
      d.type,
      d.status,
      maskNumber(d.type, d.numberLast4),
      d.expiresOn ?? '',
      d.reviewedBy ?? '',
      d.reviewedAt ?? '',
      d.rejectionReason ?? ''
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kyc-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const hasFilters = !!(q || status || type);

  return (
    <>
      {/* KPI strip */}
      <div className="grid gap-4 md:grid-cols-5">
        <KpiTile label="Pending review"  value={counts.PENDING}            tone="warning"     icon={AlertTriangle} />
        <KpiTile label="Approved · 30d"  value={counts.APPROVED}           tone="success"     icon={Check} />
        <KpiTile label="Rejected · 30d"  value={counts.REJECTED}           tone="destructive" icon={X} />
        <KpiTile label="Expiring · 30d"  value={counts.EXPIRING_30D ?? 0}  tone="warning"     icon={AlertTriangle} />
        <KpiTile label="Expired"         value={counts.EXPIRED}            tone="muted"       icon={FileText} />
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:flex-1 sm:w-auto min-w-0 sm:min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rider name or phone" className="pl-9" />
              {q && (
                <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Select value={type || '__all'} onValueChange={(v) => setType(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => <SelectItem key={o.value || '__all'} value={o.value || '__all'}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="ml-auto flex gap-2">
              {hasFilters && <Button variant="outline" size="sm" onClick={clearFilters}><X className="size-4" /> Clear</Button>}
              <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}><RefreshCw className="size-4" /> Refresh</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Status:</span>
            {STATUS_CHIPS.map((s) => (
              <Chip key={s.value || 'ALL'} active={status === s.value} onClick={() => setStatus(s.value)}>{s.label}</Chip>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {pendingSelectedIds.length > 0 && (
        <div className="rounded-lg border bg-primary/5 px-4 py-2.5 flex items-center gap-3">
          <BadgeCheck className="size-4 text-primary" />
          <span className="text-sm font-medium">{pendingSelectedIds.length} pending selected</span>
          <Button size="sm" className="ml-auto" disabled={bulkBusy} onClick={bulkApprove}>
            {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Approve {pendingSelectedIds.length}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th align="center" width="40px"></Th>
                  <Th>Rider</Th>
                  <Th>Type</Th>
                  <Th>Number</Th>
                  <Th>Status</Th>
                  <Th>
                    <button onClick={() => setSortAsc((s) => !s)} className="inline-flex items-center gap-1 hover:text-foreground">
                      Submitted <ArrowUpDown className="size-3" />
                    </button>
                  </Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading && (
                  <tr><td colSpan={7} className="p-12 text-center text-muted-foreground"><Loader2 className="size-5 animate-spin inline" /></td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={7} className="p-2">
                    <EmptyState icon={Radar} title="No documents match this filter" description="Try clearing filters or broadening your search." />
                  </td></tr>
                )}
                {!loading && sorted.map((d) => {
                  const Icon = TYPE_ICON[d.type] ?? IdCard;
                  return (
                    <tr key={d.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(d.id)}>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                          className="size-4 accent-[hsl(var(--primary))]"
                          aria-label={`Select ${d.rider.name ?? d.id}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={d.rider.name} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{d.rider.name ?? '—'}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{d.rider.phone ?? '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium">
                          <Icon className="size-3.5" /> {labelForType(d.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{maskNumber(d.type, d.numberLast4)}</td>
                      <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        <div>{relTime(d.submittedAt)}</div>
                        <div className="text-muted-foreground text-[10px]">{fmtDate(d.submittedAt)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setActiveId(d.id); }}>Review</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {activeDoc && <ReviewDrawer doc={activeDoc} onClose={() => setActiveId(null)} onChanged={load} />}
    </>
  );
}

function ReviewDrawer({ doc, onClose, onChanged }: { doc: KycDoc; onClose: () => void; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');
  const [busy, setBusy]           = useState<null | 'approve' | 'reject' | 'expire'>(null);

  async function act(action: 'approve' | 'reject' | 'expire', rejectionReason?: string) {
    setBusy(action);
    const r = await fetch(`/api/platform/kyc/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(rejectionReason ? { rejectionReason } : {}) })
    });
    setBusy(null);
    if (!r.ok) return toast.error('Failed: ' + (await r.text()));
    toast.success(action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Marked expired');
    onChanged();
    if (action !== 'expire') onClose();
  }

  const isImage = doc.fileMimeType?.startsWith('image/');
  const isPdf   = doc.fileMimeType === 'application/pdf';
  const reviewed = !!doc.reviewedAt;
  const expired = doc.expiresOn && new Date(doc.expiresOn).getTime() < Date.now();

  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={doc.rider.name ?? 'Rider'}
      subtitle={`${labelForType(doc.type)} · ${doc.rider.phone ?? '—'}`}
      badge={<StatusPill status={doc.status} />}
      width="720px"
      footer={<div className="text-[11px] text-muted-foreground">All actions are logged in the audit trail.</div>}
    >
      <DrawerSection title="Document preview" action={
        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <ExternalLink className="size-3.5" /> Open in new tab
        </a>
      }>
        <div className="p-3">
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.fileUrl} alt={doc.fileName ?? 'document'} className="w-full max-h-[400px] object-contain rounded-md border bg-muted/30" />
          )}
          {isPdf && (
            <iframe src={doc.fileUrl} className="w-full rounded-md border bg-muted/30" style={{ height: 400 }} title={doc.fileName ?? 'document'} />
          )}
          {!isImage && !isPdf && (
            <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              <FileText className="size-6 mx-auto mb-2" />
              Preview not available for {doc.fileMimeType}. Use “Open in new tab”.
            </div>
          )}
        </div>
      </DrawerSection>

      <DrawerSection title="Document metadata">
        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <Cell label="Type"       value={labelForType(doc.type)} />
          <Cell label="Number"     value={maskNumber(doc.type, doc.numberLast4)} mono />
          <Cell label="Issued on"  value={doc.issuedOn ? fmtDate(doc.issuedOn, { dateStyle: 'medium' }) : '—'} />
          <Cell label="Expires on" value={
            <span className={expired ? 'text-destructive font-semibold' : ''}>
              {doc.expiresOn ? fmtDate(doc.expiresOn, { dateStyle: 'medium' }) : '—'}{expired ? ' · EXPIRED' : ''}
            </span>
          } />
          <Cell label="Submitted"  value={fmtDate(doc.submittedAt)} />
          <Cell label="File"       value={doc.fileName ?? '—'} mono />
        </div>
      </DrawerSection>

      {reviewed ? (
        <DrawerSection title="Review history">
          <div className="p-4 space-y-2 text-sm">
            <div><span className="text-muted-foreground">Reviewer:</span> <span className="font-mono text-xs">{doc.reviewedBy ?? '—'}</span></div>
            <div><span className="text-muted-foreground">Reviewed at:</span> {doc.reviewedAt ? fmtDate(doc.reviewedAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div>
            {doc.rejectionReason && (
              <div className="rounded-md bg-destructive/10 text-destructive p-2 text-xs">
                <strong>Rejection reason:</strong> {doc.rejectionReason}
              </div>
            )}
            {doc.status !== 'EXPIRED' && (
              <Button size="sm" variant="outline" disabled={busy === 'expire'} onClick={() => act('expire')} className="mt-2">
                {busy === 'expire' ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />} Mark expired
              </Button>
            )}
          </div>
        </DrawerSection>
      ) : (
        <DrawerSection title="Approval">
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="success"
                disabled={busy !== null}
                onClick={() => act('approve')}
              >
                {busy === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Approve
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => setRejecting((v) => !v)}
                className="text-destructive border-destructive/40 hover:bg-destructive/5"
              >
                <X className="size-4" /> Reject
              </Button>
            </div>
            {rejecting && (
              <div className="space-y-2">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for rejection (required, visible to rider)"
                  rows={3}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!reason.trim() || busy !== null}
                  onClick={() => act('reject', reason.trim())}
                >
                  {busy === 'reject' ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Submit rejection
                </Button>
              </div>
            )}
          </div>
        </DrawerSection>
      )}
    </DetailDrawer>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function KpiTile({ label, value, tone, icon: Icon }: { label: string; value: number; tone: 'primary' | 'success' | 'warning' | 'destructive' | 'muted'; icon: typeof Check }) {
  const cls = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    muted: 'bg-muted text-muted-foreground'
  }[tone];
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-lg shrink-0 ${cls}`}><Icon className="size-5" /></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="font-bold text-xl leading-tight">{(value ?? 0).toLocaleString('en-IN')}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function Th({ children, align = 'left', width }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; width?: string }) {
  const a = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return <th style={width ? { width } : undefined} className={`${a} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Avatar({ name }: { name: string | null }) {
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
  return <div className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">{initials}</div>;
}

function StatusPill({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, string> = {
    PENDING:  'bg-warning/15 text-warning border-warning/30',
    APPROVED: 'bg-success/15 text-success border-success/30',
    REJECTED: 'bg-destructive/15 text-destructive border-destructive/30',
    EXPIRED:  'bg-muted text-muted-foreground'
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[status]}`}>{status}</span>;
}

function Cell({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${mono ? 'font-mono text-xs' : 'text-sm'} break-all`}>{value}</div>
    </div>
  );
}

function labelForType(t: DocType): string {
  return ({ AADHAAR: 'Aadhaar', DL: 'Driving licence', INSURANCE: 'Insurance', RC: 'RC', PAN: 'PAN' } as Record<DocType, string>)[t] ?? t;
}
