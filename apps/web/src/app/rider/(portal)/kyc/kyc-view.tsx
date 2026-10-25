'use client';
/**
 * KYC documents — list, status and upload, using the same GET/POST
 * /api/rider/kyc the app uses (multipart: type, number, issuedOn, expiresOn,
 * file). Uploading a type again replaces the earlier file and resets review.
 */
import { useState } from 'react';
import { FileCheck2, Upload, ExternalLink, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { riderApi, fmtDate } from '../../_lib/api';
import type { KycDoc, KycRequirement, KycResponse } from '../../_lib/types';
import { ErrorPanel, PageHeader, Panel, inputCls, useLoad } from '../../_components/bits';

const DEFAULT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DEFAULT_MAX = 8 * 1024 * 1024;

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function statusChip(doc: KycDoc | undefined): { label: string; cls: string } {
  if (!doc) return { label: 'Not uploaded', cls: 'bg-muted text-muted-foreground' };
  const d = daysUntil(doc.expiresOn);
  switch (doc.status) {
    case 'APPROVED':
      if (d != null && d < 0) return { label: 'Expired', cls: 'bg-destructive/10 text-destructive' };
      if (d != null && d <= 30) return { label: `Expires in ${d} day${d === 1 ? '' : 's'}`, cls: 'bg-warning/15 text-warning' };
      return { label: 'Approved', cls: 'bg-success/15 text-success' };
    case 'PENDING':
      return { label: 'Pending review', cls: 'bg-warning/15 text-warning' };
    case 'REJECTED':
      return { label: 'Rejected', cls: 'bg-destructive/10 text-destructive' };
    case 'EXPIRED':
      return { label: 'Expired', cls: 'bg-destructive/10 text-destructive' };
    default:
      return { label: doc.status, cls: 'bg-muted text-muted-foreground' };
  }
}

export function KycView() {
  const kyc = useLoad(() => riderApi<KycResponse>('/api/rider/kyc'));
  const [editing, setEditing] = useState<string | null>(null);

  const reqs: KycRequirement[] =
    kyc.data?.requirements ??
    // Older servers: derive rows from the documents themselves.
    (kyc.data?.documents ?? []).map((d) => ({
      type: d.type,
      label: d.type.replace(/_/g, ' '),
      required: false,
      needsExpiry: false,
      numberLabel: 'Document number',
      numberPlaceholder: '',
      hint: null,
    }));
  const docsByType = new Map((kyc.data?.documents ?? []).map((d) => [d.type, d]));
  const gating = kyc.data?.gating;

  return (
    <div className="space-y-5">
      <PageHeader title="Documents (KYC)" intro="Upload your ID, licence and vehicle documents. Our team reviews each one, usually within 24 hours." />

      {kyc.error ? (
        <ErrorPanel message={kyc.error} onRetry={kyc.reload} />
      ) : kyc.loading && !kyc.data ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          {gating?.enforced && (
            <div
              className={cn(
                'rounded-2xl border p-4 text-sm',
                gating.canGoOnline ? 'border-success/30 bg-success/10' : 'border-warning/40 bg-warning/10',
              )}
            >
              {gating.canGoOnline
                ? 'Your required documents are in order — you can go online in the app.'
                : gating.message ?? 'Some required documents are missing or not approved yet, so you cannot go online.'}
            </div>
          )}

          {reqs.length === 0 ? (
            <Panel>
              <p className="text-sm text-muted-foreground">No documents are required for your account right now.</p>
            </Panel>
          ) : (
            <ul className="space-y-3">
              {reqs.map((r) => {
                const doc = docsByType.get(r.type);
                const chip = statusChip(doc);
                const action = !doc ? 'Upload' : doc.status === 'REJECTED' || doc.status === 'EXPIRED' ? 'Re-upload' : 'Replace';
                return (
                  <li key={r.type} className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-semibold">
                          <FileCheck2 className="size-4 text-primary" /> {r.label}
                          {r.required && <span className="text-xs font-normal text-muted-foreground">· required</span>}
                        </div>
                        {doc ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {doc.numberMasked ? `${doc.numberMasked} · ` : ''}
                            {doc.submittedAt ? `Submitted ${fmtDate(doc.submittedAt)}` : ''}
                            {doc.expiresOn ? ` · Expires ${fmtDate(doc.expiresOn)}` : ''}
                          </div>
                        ) : (
                          r.hint && <div className="mt-1 text-xs text-muted-foreground">{r.hint}</div>
                        )}
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', chip.cls)}>{chip.label}</span>
                    </div>
                    {doc?.status === 'REJECTED' && doc.rejectionReason && (
                      <p className="mt-2 rounded-lg bg-destructive/5 p-2 text-sm text-destructive">Reason: {doc.rejectionReason}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {doc?.fileUrl && (
                        <a
                          href={doc.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium hover:bg-muted"
                        >
                          <ExternalLink className="size-4" /> View
                        </a>
                      )}
                      {editing !== r.type && (
                        <Button variant={doc ? 'outline' : 'default'} className="min-h-11 rounded-full" onClick={() => setEditing(r.type)}>
                          <Upload /> {action}
                        </Button>
                      )}
                    </div>
                    {editing === r.type && (
                      <UploadForm
                        req={r}
                        accept={kyc.data?.accept ?? DEFAULT_ACCEPT}
                        maxBytes={kyc.data?.maxBytes ?? DEFAULT_MAX}
                        onCancel={() => setEditing(null)}
                        onDone={async () => {
                          setEditing(null);
                          await kyc.reload();
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function UploadForm({
  req,
  accept,
  maxBytes,
  onCancel,
  onDone,
}: {
  req: KycRequirement;
  accept: string[];
  maxBytes: number;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `kyc-${req.type}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!number.trim()) return setError(`Enter the ${req.numberLabel.toLowerCase()}.`);
    if (req.needsExpiry && !expiresOn) return setError('Enter the expiry date.');
    if (!file) return setError('Choose a photo or PDF of the document.');
    if (!accept.includes(file.type)) return setError('Use a JPG, PNG, WebP photo or a PDF.');
    if (file.size > maxBytes) return setError(`The file is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).`);
    const form = new FormData();
    form.append('type', req.type);
    form.append('number', number.trim());
    if (issuedOn) form.append('issuedOn', issuedOn);
    if (expiresOn) form.append('expiresOn', expiresOn);
    form.append('file', file);
    setBusy(true);
    try {
      await riderApi('/api/rider/kyc', { method: 'POST', form });
      toast.success(`${req.label} uploaded — it's now pending review.`);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-4">
      <div>
        <Label htmlFor={`${id}-num`}>{req.numberLabel}</Label>
        <input id={`${id}-num`} className={cn(inputCls, 'mt-1')} value={number} onChange={(e) => setNumber(e.target.value)} placeholder={req.numberPlaceholder} autoComplete="off" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-issued`}>Issued on (optional)</Label>
          <input id={`${id}-issued`} type="date" className={cn(inputCls, 'mt-1')} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-exp`}>Expires on{req.needsExpiry ? '' : ' (optional)'}</Label>
          <input id={`${id}-exp`} type="date" className={cn(inputCls, 'mt-1')} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-file`}>Photo or PDF</Label>
        <input
          id={`${id}-file`}
          type="file"
          accept={accept.join(',')}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:text-sm file:font-semibold file:text-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WebP or PDF · up to {Math.round(maxBytes / (1024 * 1024))} MB. Make sure every detail is readable.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="min-h-11 flex-1 sm:flex-none">
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="min-h-11">
          <X /> Cancel
        </Button>
      </div>
    </form>
  );
}
