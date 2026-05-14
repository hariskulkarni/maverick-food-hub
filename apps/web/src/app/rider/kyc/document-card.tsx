'use client';
/**
 * DocumentCard — one slot per required KYC doc type.
 *
 * Stateful flows handled here:
 *   - NOT UPLOADED      → upload form (number + optional dates + file)
 *   - PENDING           → read-only review state ("Awaiting review")
 *   - APPROVED          → masked summary + "Replace document" → DELETE then upload
 *   - REJECTED          → rejection banner + "Upload again" → DELETE then upload
 *   - EXPIRED           → expired banner + "Upload new" → DELETE then upload
 *
 * Number masking: we NEVER store or render the raw number client-side after
 * submit — the server returns only `numberLast4`. The `maskNumber()` helper
 * formats a presentational masked string from that last-4.
 *
 * Upload uses XHR (not fetch) so we can wire `upload.onprogress` for the
 * visible progress bar, matching the existing <ImageUploader> pattern.
 */
import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';
import {
  Upload,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  AlertTriangle,
  FileText,
  Replace,
  Calendar,
  type LucideIcon,
} from 'lucide-react';

export type DocType = 'AADHAAR' | 'DRIVING_LICENSE' | 'VEHICLE_INSURANCE' | 'VEHICLE_RC' | 'PAN_CARD';
export type DocStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface RiderKycDocument {
  id: string;
  type: DocType;
  status: DocStatus;
  numberLast4: string | null;
  fileUrl: string | null;
  fileName: string | null;
  expiresOn: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

interface Props {
  type: DocType;
  label: string;
  icon: LucideIcon;
  doc: RiderKycDocument | undefined;
  /** Re-fetch the documents list after any successful mutation. */
  onChanged: () => void;
}

/**
 * Per-type validation. We only check the *shape* of the number client-side;
 * the server is the source of truth for uniqueness and authenticity.
 *  - AADHAAR: 12 digits
 *  - DL: state code (2 alphas) + 13 digits OR 16 alphanumeric — accept the looser
 *        IN DL regex many state RTOs emit.
 *  - PAN: ABCDE1234F (5 alphas, 4 digits, 1 alpha)
 *  - VEHICLE_RC: state code (2A) + 1-2 digits + optional 1-2 alphas + 4 digits
 *  - VEHICLE_INSURANCE: alphanumeric, 6-20 (policy numbers vary by insurer)
 */
const NUMBER_RULES: Record<DocType, { regex: RegExp; placeholder: string; hint: string; maxLength: number }> = {
  AADHAAR: {
    regex: /^\d{12}$/,
    placeholder: '12-digit Aadhaar number',
    hint: '12 digits, no spaces',
    maxLength: 12,
  },
  DRIVING_LICENSE: {
    regex: /^[A-Z]{2}[\dA-Z]{2,15}$/i,
    placeholder: 'e.g. MH1420110012345',
    hint: 'State code + RTO + serial',
    maxLength: 17,
  },
  VEHICLE_INSURANCE: {
    regex: /^[A-Z0-9-]{6,24}$/i,
    placeholder: 'Policy number',
    hint: 'As shown on your policy schedule',
    maxLength: 24,
  },
  VEHICLE_RC: {
    regex: /^[A-Z]{2}[\dA-Z]{1,12}$/i,
    placeholder: 'e.g. MH12AB1234',
    hint: 'Vehicle registration number',
    maxLength: 13,
  },
  PAN_CARD: {
    regex: /^[A-Z]{5}\d{4}[A-Z]$/i,
    placeholder: 'e.g. ABCDE1234F',
    hint: '5 letters, 4 digits, 1 letter',
    maxLength: 10,
  },
};

/* ---------- helpers ---------- */

/** Build a masked display string from just the last-4 of a doc number. */
export function maskNumber(last4: string | null | undefined, type: DocType): string {
  if (!last4) return '••••';
  if (type === 'AADHAAR') return `XXXX XXXX ${last4}`;
  if (type === 'PAN_CARD') return `XXXXX${last4}`;
  return `•••• ${last4}`;
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
}

function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(url);
}

/* ---------- card root ---------- */

export function DocumentCard({ type, label, icon: Icon, doc, onChanged }: Props) {
  // "uploading" view forces the upload UI even if the doc currently exists
  // (used by Replace/Upload-again/Upload-new flows).
  const [editing, setEditing] = useState(false);
  const sectionId = `kyc-${type.toLowerCase()}`;

  const showUpload = !doc || editing;

  return (
    <section
      aria-labelledby={`${sectionId}-title`}
      className="rounded-2xl border bg-card shadow-sm card-lift overflow-hidden"
    >
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-gradient-to-br from-card to-muted/20">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
          <Icon className="size-4" />
        </div>
        <h3 id={`${sectionId}-title`} className="flex-1 min-w-0 text-sm font-semibold truncate">
          {label}
        </h3>
        <CardPill status={doc?.status ?? 'NOT_UPLOADED'} />
      </header>

      <div className="p-4">
        {showUpload ? (
          <UploadForm
            type={type}
            existingId={doc?.id}
            onCancel={editing ? () => setEditing(false) : undefined}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
        ) : (
          <DocumentSummary doc={doc!} type={type} onReplace={() => setEditing(true)} />
        )}
      </div>
    </section>
  );
}

/* ---------- pill (in-card) ---------- */

function CardPill({ status }: { status: DocStatus | 'NOT_UPLOADED' }) {
  const map: Record<DocStatus | 'NOT_UPLOADED', { text: string; cls: string; Icon: LucideIcon }> = {
    APPROVED: { text: 'Approved', cls: 'bg-success/10 text-success border-success/30', Icon: CheckCircle2 },
    PENDING: { text: 'Awaiting review', cls: 'bg-primary/10 text-primary border-primary/30', Icon: Clock },
    REJECTED: { text: 'Rejected', cls: 'bg-destructive/10 text-destructive border-destructive/30', Icon: ShieldAlert },
    EXPIRED: { text: 'Expired', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', Icon: AlertTriangle },
    NOT_UPLOADED: { text: 'Not uploaded', cls: 'bg-muted text-muted-foreground border-border', Icon: Upload },
  };
  const meta = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0 ${meta.cls}`}
      aria-label={`Status: ${meta.text}`}
    >
      <meta.Icon className="size-3" aria-hidden />
      {meta.text}
    </span>
  );
}

/* ---------- summary (rendered when doc exists and we're not editing) ---------- */

function DocumentSummary({
  doc,
  type,
  onReplace,
}: {
  doc: RiderKycDocument;
  type: DocType;
  onReplace: () => void;
}) {
  const masked = maskNumber(doc.numberLast4, type);
  const imageOk = isImageUrl(doc.fileUrl);

  return (
    <div className="space-y-3">
      {/* State-specific banners — rejection / expiry / approved tick. */}
      {doc.status === 'REJECTED' && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <div className="font-semibold flex items-center gap-1.5">
            <ShieldAlert className="size-3.5" /> Document rejected
          </div>
          {doc.rejectionReason && <p className="mt-1 italic opacity-90">&ldquo;{doc.rejectionReason}&rdquo;</p>}
        </div>
      )}
      {doc.status === 'EXPIRED' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <div className="font-semibold flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" /> Expired on {fmtDay(doc.expiresOn)}
          </div>
          <p className="mt-1 opacity-90">Upload a fresh copy to continue accepting deliveries.</p>
        </div>
      )}
      {doc.status === 'APPROVED' && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-xs text-success flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5" />
          <span className="font-semibold">Verified</span>
          {doc.reviewedAt && <span className="opacity-80">· Reviewed on {fmtDay(doc.reviewedAt)}</span>}
        </div>
      )}

      <div className="flex gap-3">
        {/* Preview — Next/Image for raster, document icon otherwise. */}
        <div className="size-16 shrink-0 rounded-lg border bg-muted/40 overflow-hidden relative">
          {imageOk && doc.fileUrl ? (
            <Image
              src={doc.fileUrl}
              alt={doc.fileName || 'Document preview'}
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <FileText className="size-6" aria-hidden />
            </div>
          )}
        </div>

        <dl className="flex-1 min-w-0 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Number</dt>
            <dd className="font-mono">{masked}</dd>
          </div>
          {doc.expiresOn && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{fmtDay(doc.expiresOn)}</dd>
            </div>
          )}
          {doc.submittedAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Submitted</dt>
              <dd>{fmtDay(doc.submittedAt)}</dd>
            </div>
          )}
          {doc.fileName && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">File</dt>
              <dd className="truncate max-w-[10rem]" title={doc.fileName}>
                {doc.fileName}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* CTA. PENDING has no action — review is in flight. */}
      {doc.status === 'PENDING' ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Clock className="size-3" /> We&rsquo;ll notify you once review is complete (usually within a day).
        </p>
      ) : (
        <button
          type="button"
          onClick={onReplace}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-accent tap-press"
        >
          {doc.status === 'REJECTED' ? (
            <>
              <Upload className="size-3.5" /> Upload again
            </>
          ) : doc.status === 'EXPIRED' ? (
            <>
              <Upload className="size-3.5" /> Upload new
            </>
          ) : (
            <>
              <Replace className="size-3.5" /> Replace document
            </>
          )}
        </button>
      )}
    </div>
  );
}

/* ---------- upload form (NOT_UPLOADED + all "replace" flows) ---------- */

function UploadForm({
  type,
  existingId,
  onCancel,
  onDone,
}: {
  type: DocType;
  /** If we're replacing, the existing doc id we must DELETE first. */
  existingId: string | undefined;
  onCancel?: () => void;
  onDone: () => void;
}) {
  const rules = NUMBER_RULES[type];

  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [numberTouched, setNumberTouched] = useState(false);
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const numberValid = useMemo(() => rules.regex.test(number.trim()), [rules.regex, number]);
  const showNumberError = numberTouched && number.length > 0 && !numberValid;

  function pickFile(f: File | null) {
    if (!f) return;
    // 10 MB cap — typical for KYC images / PDF scans.
    if (f.size > 10 * 1024 * 1024) {
      setError('File too large — max 10 MB.');
      return;
    }
    const okType = /^(image\/(jpeg|png|webp))|application\/pdf$/i.test(f.type);
    if (!okType) {
      setError('Only JPG, PNG, WebP, or PDF files are allowed.');
      return;
    }
    setError(null);
    setFile(f);
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      if (localPreview) URL.revokeObjectURL(localPreview);
      setLocalPreview(url);
    } else {
      if (localPreview) URL.revokeObjectURL(localPreview);
      setLocalPreview(null);
    }
  }

  function clearFile() {
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    setFile(null);
  }

  async function submit() {
    setNumberTouched(true);
    if (!file) {
      setError('Please attach a file.');
      return;
    }
    if (!numberValid) {
      setError(`Number doesn't match the expected format (${rules.hint}).`);
      return;
    }
    setError(null);
    setBusy(true);
    setProgress(0);
    try {
      // Replace flow: delete the existing doc first so the POST creates a fresh one.
      if (existingId) {
        const del = await fetch(`/api/rider/kyc/${encodeURIComponent(existingId)}`, { method: 'DELETE' });
        if (!del.ok) throw new Error(`Couldn't remove the old document (HTTP ${del.status}).`);
      }
      await uploadWithProgress({
        file,
        type,
        number: number.trim(),
        issuedOn: issuedOn || undefined,
        expiresOn: expiresOn || undefined,
        onProgress: setProgress,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) pickFile(f);
        }}
        className={`relative rounded-xl border-2 border-dashed p-3 cursor-pointer transition-colors min-h-[6rem] ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary hover:bg-primary/5'
        }`}
        aria-label="Upload document file"
      >
        {file ? (
          <div className="flex items-center gap-3">
            <div className="size-14 shrink-0 rounded-lg overflow-hidden border bg-card relative">
              {localPreview ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={localPreview} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                  <FileText className="size-6" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · {file.type || 'file'}</div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearFile();
              }}
              className="rounded-full p-1 text-muted-foreground hover:bg-accent"
              aria-label="Remove file"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="mx-auto inline-grid size-9 place-items-center rounded-full bg-card mb-1 shadow-sm">
              <Upload className="size-4" />
            </div>
            <div className="text-xs font-medium">Drop a file or tap to choose</div>
            <div className="text-[10px] opacity-80 mt-0.5">JPG, PNG, WebP or PDF · max 10 MB</div>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-card/85 backdrop-blur">
            <div className="text-center">
              <Loader2 className="size-5 mx-auto animate-spin text-primary" />
              <div className="mt-1 text-[11px] font-medium">{progress > 0 ? `Uploading ${progress}%` : 'Preparing…'}</div>
              <div className="mt-1 h-1 w-28 rounded-full bg-muted overflow-hidden mx-auto">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          pickFile(f);
          if (e.target) e.target.value = '';
        }}
      />

      {/* Number field */}
      <label className="block">
        <div className="text-[11px] font-medium text-muted-foreground mb-1">Document number</div>
        <input
          type="text"
          inputMode={type === 'AADHAAR' ? 'numeric' : 'text'}
          autoComplete="off"
          spellCheck={false}
          maxLength={rules.maxLength}
          value={number}
          onChange={(e) => setNumber(type === 'AADHAAR' ? e.target.value.replace(/\D/g, '') : e.target.value.toUpperCase())}
          onBlur={() => setNumberTouched(true)}
          placeholder={rules.placeholder}
          className={`w-full rounded-lg border bg-card px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 ${
            showNumberError ? 'border-destructive' : 'border-border'
          }`}
          aria-invalid={showNumberError}
          aria-describedby={`${type}-hint`}
        />
        <p id={`${type}-hint`} className={`mt-1 text-[11px] ${showNumberError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {showNumberError ? `Doesn't match expected format — ${rules.hint}.` : rules.hint}
        </p>
      </label>

      {/* Optional dates — most docs care about expiry; issuance is bonus context. */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
            <Calendar className="size-3" /> Issued on
          </div>
          <input
            type="date"
            value={issuedOn}
            onChange={(e) => setIssuedOn(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <label className="block">
          <div className="text-[11px] font-medium text-muted-foreground mb-1 flex items-center gap-1">
            <Calendar className="size-3" /> Expires on
          </div>
          <input
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5" /> {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 inline-flex items-center justify-center rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-60 tap-press"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !file || !numberValid}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 tap-press"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {busy ? 'Uploading…' : existingId ? 'Replace' : 'Upload'}
        </button>
      </div>
    </div>
  );
}

/* ---------- XHR upload with progress ---------- */

interface UploadArgs {
  file: File;
  type: DocType;
  number: string;
  issuedOn?: string;
  expiresOn?: string;
  onProgress: (pct: number) => void;
}

function uploadWithProgress({ file, type, number, issuedOn, expiresOn, onProgress }: UploadArgs): Promise<RiderKycDocument> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', type);
    fd.append('number', number);
    if (issuedOn) fd.append('issuedOn', issuedOn);
    if (expiresOn) fd.append('expiresOn', expiresOn);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/rider/kyc');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as RiderKycDocument);
        } catch {
          reject(new Error('Bad response from server.'));
        }
      } else {
        // Surface the server's error message when present (validation, dupes, etc.)
        let msg = `HTTP ${xhr.status}`;
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed?.error || parsed?.message) msg = parsed.error || parsed.message;
        } catch {
          if (xhr.responseText) msg = xhr.responseText.slice(0, 200);
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error.'));
    xhr.send(fd);
  });
}
