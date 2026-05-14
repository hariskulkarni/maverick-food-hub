'use client';
/**
 * Rider KYC client — orchestrates the documents list.
 *
 * - Fetches GET /api/rider/kyc on mount and after every mutation.
 * - Renders a status hero strip computed from the document list.
 * - Renders one DocumentCard per required type (5 total). The card itself
 *   handles upload / replace / delete for its slot via callbacks back here.
 *
 * Status precedence in the hero (matches the spec):
 *   REJECTED  > EXPIRED > APPROVED(all 3 core)  > IN-PROGRESS
 *
 * The 3 "core" docs that gate "Verified rider" are AADHAAR, DRIVING_LICENSE,
 * VEHICLE_INSURANCE. PAN and Vehicle RC are listed but optional for the
 * green banner — that matches what the rider ops team flagged on 2026-05.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  FileText,
  CreditCard,
  Car,
  IdCard,
  ScrollText,
} from 'lucide-react';
import { DocumentCard, type DocType, type DocStatus, type RiderKycDocument } from './document-card';

const REQUIRED_TYPES: DocType[] = ['AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_INSURANCE', 'VEHICLE_RC', 'PAN_CARD'];
const CORE_TYPES: DocType[] = ['AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_INSURANCE'];

const TYPE_LABEL: Record<DocType, string> = {
  AADHAAR: 'Aadhaar Card',
  DRIVING_LICENSE: 'Driving Licence',
  VEHICLE_INSURANCE: 'Vehicle Insurance',
  VEHICLE_RC: 'Vehicle RC',
  PAN_CARD: 'PAN Card',
};

const TYPE_ICON: Record<DocType, typeof IdCard> = {
  AADHAAR: IdCard,
  DRIVING_LICENSE: ScrollText,
  VEHICLE_INSURANCE: ShieldCheck,
  VEHICLE_RC: Car,
  PAN_CARD: CreditCard,
};

type ApiResponse = { documents: RiderKycDocument[] };

export function RiderKycClient() {
  const [docs, setDocs] = useState<RiderKycDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch('/api/rider/kyc', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ApiResponse;
      setDocs(Array.isArray(j.documents) ? j.documents : []);
    } catch (e) {
      setLoadError((e as Error).message || 'Failed to load');
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Build a stable lookup: latest document per type. If somehow the API
  // returns multiple per type, we prefer the most recently submitted one.
  const byType = useMemo<Record<DocType, RiderKycDocument | undefined>>(() => {
    const map: Partial<Record<DocType, RiderKycDocument>> = {};
    if (!docs) return map as Record<DocType, RiderKycDocument | undefined>;
    for (const d of docs) {
      const existing = map[d.type];
      if (!existing) {
        map[d.type] = d;
        continue;
      }
      const a = Date.parse(existing.submittedAt || '') || 0;
      const b = Date.parse(d.submittedAt || '') || 0;
      if (b > a) map[d.type] = d;
    }
    return map as Record<DocType, RiderKycDocument | undefined>;
  }, [docs]);

  const summary = useMemo(() => summarise(byType), [byType]);

  return (
    <div className="space-y-4 pb-6">
      <header>
        <h1 className="display text-xl font-semibold">Documents &amp; KYC</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload your ID, licence, and vehicle papers. We mask numbers — only the last 4 digits ever leave your device unredacted.
        </p>
      </header>

      <HeroStrip summary={summary} />

      {loadError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          Couldn&rsquo;t load your documents: {loadError}.{' '}
          <button type="button" onClick={load} className="underline font-medium">
            Try again
          </button>
        </div>
      )}

      {docs === null ? (
        <div className="grid place-items-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <section
          aria-label="Required documents"
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          {REQUIRED_TYPES.map((t) => (
            <DocumentCard
              key={t}
              type={t}
              label={TYPE_LABEL[t]}
              icon={TYPE_ICON[t]}
              doc={byType[t]}
              onChanged={load}
            />
          ))}
        </section>
      )}
    </div>
  );
}

/* -------- Hero strip -------- */

type HeroState =
  | { kind: 'rejected'; rejectedCount: number }
  | { kind: 'expired'; expiredCount: number }
  | { kind: 'verified' }
  | { kind: 'progress'; approved: number; total: number };

interface Summary {
  hero: HeroState;
  rows: { type: DocType; status: DocStatus | 'NOT_UPLOADED' }[];
}

function summarise(byType: Record<DocType, RiderKycDocument | undefined>): Summary {
  const rows = REQUIRED_TYPES.map((t) => {
    const d = byType[t];
    return { type: t, status: (d?.status ?? 'NOT_UPLOADED') as DocStatus | 'NOT_UPLOADED' };
  });

  const rejectedCount = rows.filter((r) => r.status === 'REJECTED').length;
  const expiredCount = rows.filter((r) => r.status === 'EXPIRED').length;
  const coreApproved = CORE_TYPES.every((t) => byType[t]?.status === 'APPROVED');
  const approvedTotal = rows.filter((r) => r.status === 'APPROVED').length;

  let hero: HeroState;
  if (rejectedCount > 0) hero = { kind: 'rejected', rejectedCount };
  else if (expiredCount > 0) hero = { kind: 'expired', expiredCount };
  else if (coreApproved) hero = { kind: 'verified' };
  else hero = { kind: 'progress', approved: approvedTotal, total: REQUIRED_TYPES.length };

  return { hero, rows };
}

function HeroStrip({ summary }: { summary: Summary }) {
  const { hero, rows } = summary;

  const tone =
    hero.kind === 'rejected'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : hero.kind === 'expired'
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
      : hero.kind === 'verified'
      ? 'border-success/30 bg-success/5 text-success'
      : 'border-primary/30 bg-primary/5 text-primary';

  const Icon =
    hero.kind === 'rejected'
      ? ShieldAlert
      : hero.kind === 'expired'
      ? AlertTriangle
      : hero.kind === 'verified'
      ? ShieldCheck
      : FileText;

  const title =
    hero.kind === 'rejected'
      ? 'Action needed'
      : hero.kind === 'expired'
      ? 'Renew documents'
      : hero.kind === 'verified'
      ? 'Verified rider'
      : 'Complete your verification';

  const subtitle =
    hero.kind === 'rejected'
      ? `${hero.rejectedCount} document${hero.rejectedCount === 1 ? '' : 's'} rejected — please re-upload.`
      : hero.kind === 'expired'
      ? `${hero.expiredCount} document${hero.expiredCount === 1 ? '' : 's'} expired — upload a fresh copy.`
      : hero.kind === 'verified'
      ? 'Your ID, licence, and insurance are approved. You’re all set.'
      : `${hero.approved} of ${hero.total} approved`;

  const pulsing = hero.kind === 'rejected' || hero.kind === 'expired';

  return (
    <section aria-labelledby="kyc-hero-title" className={`rounded-2xl border p-4 card-lift ${tone}`}>
      <div className="flex items-start gap-3">
        <div className={`grid size-10 place-items-center rounded-xl bg-card shadow-sm shrink-0 ${pulsing ? 'pulse-soft' : ''}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="kyc-hero-title" className="text-base font-semibold leading-tight">
            {title}
          </h2>
          <p className="text-xs opacity-90 mt-0.5">{subtitle}</p>
          {hero.kind === 'progress' && (
            <div className="mt-2 h-1.5 rounded-full bg-card/60 overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round((hero.approved / hero.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tight per-doc pill row, no card chrome — fits below the headline. */}
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <li key={r.type}>
            <StatusPill label={TYPE_LABEL[r.type]} status={r.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusPill({ label, status }: { label: string; status: DocStatus | 'NOT_UPLOADED' }) {
  const map: Record<DocStatus | 'NOT_UPLOADED', { text: string; cls: string }> = {
    APPROVED: { text: 'Approved', cls: 'bg-success/10 text-success border-success/30' },
    PENDING: { text: 'Pending', cls: 'bg-primary/10 text-primary border-primary/30' },
    REJECTED: { text: 'Rejected', cls: 'bg-destructive/10 text-destructive border-destructive/30' },
    EXPIRED: { text: 'Expired', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30' },
    NOT_UPLOADED: { text: 'Not uploaded', cls: 'bg-muted text-muted-foreground border-border' },
  };
  const meta = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
      aria-label={`${label}: ${meta.text}`}
    >
      <span className="truncate max-w-[140px]">{label}</span>
      <span className="opacity-60">·</span>
      <span>{meta.text}</span>
    </span>
  );
}
