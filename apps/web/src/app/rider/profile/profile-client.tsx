'use client';
/**
 * Rider Profile client UI — owns the four-tab layout under `/rider/profile`.
 *
 * Layout
 * ─ Hero: saffron gradient, avatar, name/phone, online pill, stat strip
 * ─ Verification progress card: "X of 5 verified" + saffron bar
 * ─ Sticky tab bar: Personal · Vehicle · Documents · Payouts
 *
 * The "Documents" tab is the centerpiece — 5 cards (Aadhaar, DL, Insurance,
 * RC, PAN), each in one of six states with distinct visuals. Tapping a card
 * opens a full-screen `<UploadSheet>` (bottom-aligned) with number input,
 * format validation, optional real-time vendor verification (PAN/DL), date
 * inputs, and a file picker. Submission → multipart POST to /api/rider/kyc.
 *
 * State management is intentionally simple: server data is passed in once;
 * after any mutation we call `router.refresh()` which re-runs the server
 * component and re-hydrates this client with fresh props.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import {
  Bike,
  Star,
  IndianRupee,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Upload,
  Loader2,
  X,
  FileText,
  Pencil,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  IdCard,
  CreditCard,
  Car,
  ScrollText,
  Truck,
  User as UserIcon,
  Wallet,
  Languages,
  Phone,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { CLIENT_RULES, TYPE_LABEL, TYPE_HELPER, normalizeNumber, isFormatValid, mask, type ClientDocType } from './_validators';

// ────────────────────────────────────────────────────────────────────────────
// Wire types (mirror what page.tsx serializes)
// ────────────────────────────────────────────────────────────────────────────

type DocStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
type VerifierStatus = 'PENDING' | 'PASS' | 'FAIL' | 'ERROR' | 'UNSUPPORTED' | null;

interface DocWire {
  id: string;
  type: ClientDocType;
  status: DocStatus;
  numberLast4: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileMimeType: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  verifierProvider: string | null;
  verifierStatus: VerifierStatus;
  verifierMessage: string | null;
  verifiedAt: string | null;
}

export interface ProfileData {
  user: { id: string; name: string | null; phone: string | null; email: string | null; avatarUrl: string | null };
  profile: {
    id: string;
    vehicleType: string;
    vehicleNumber: string | null;
    isOnline: boolean;
    currentLat: number | null;
    currentLng: number | null;
    rating: number;
    totalDeliveries: number;
    totalEarnings: number;
    totalTips: number;
    approvedAt: string | null;
  };
  documents: DocWire[];
  summary: { counts: { missing: number; pending: number; approved: number; rejected: number; expired: number }; fullyApproved: boolean };
  initialTab: 'personal' | 'vehicle' | 'documents' | 'payouts';
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const REQUIRED_TYPES: ClientDocType[] = ['AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_INSURANCE', 'VEHICLE_RC', 'PAN_CARD'];
const TYPE_ICON: Record<ClientDocType, LucideIcon> = {
  AADHAAR: IdCard,
  DRIVING_LICENSE: ScrollText,
  VEHICLE_INSURANCE: ShieldCheck,
  VEHICLE_RC: Car,
  PAN_CARD: CreditCard,
};

const TABS = [
  { id: 'personal' as const, label: 'Personal', Icon: UserIcon },
  { id: 'vehicle' as const, label: 'Vehicle', Icon: Truck },
  { id: 'documents' as const, label: 'Documents', Icon: ShieldCheck },
  { id: 'payouts' as const, label: 'Payouts', Icon: Wallet },
];

// ────────────────────────────────────────────────────────────────────────────
// Root
// ────────────────────────────────────────────────────────────────────────────

export function ProfileClient({ data }: { data: ProfileData }) {
  const [tab, setTab] = useState<ProfileData['initialTab']>(data.initialTab);

  // When the parent server page refreshes (router.refresh), keep the active
  // tab pinned to whatever the user is looking at — but if they deep-linked
  // via `?tab=`, honour that on first mount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { /* no-op, tab state is local */ }, []);

  const initials = useMemo(() => {
    const src = data.user.name || data.user.phone || '?';
    return src.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }, [data.user.name, data.user.phone]);

  const verifiedCount = data.documents.filter((d) => d.status === 'APPROVED').length;
  const progressPct = Math.round((verifiedCount / REQUIRED_TYPES.length) * 100);

  return (
    <div className="-mx-4 -mt-4 pb-24">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="gradient-hero px-4 pt-6 pb-5 reveal">
        <div className="flex items-center gap-3">
          <div className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground font-bold text-xl shadow-lg shadow-primary/30 shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold truncate">{data.user.name || 'Rider'}</div>
            {data.user.phone && (
              <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{data.user.phone}</div>
            )}
            <div className="mt-1.5">
              <OnlinePill online={data.profile.isOnline} approvedAt={data.profile.approvedAt} />
            </div>
          </div>
        </div>

        {/* Stat strip — Deliveries · Rating · Earnings */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat icon={Bike} label="Trips" value={String(data.profile.totalDeliveries)} />
          <Stat icon={Star} label="Rating" value={data.profile.rating.toFixed(1)} />
          <Stat icon={IndianRupee} label="Earned" value={inrCompact(data.profile.totalEarnings)} />
        </div>
      </section>

      {/* ── Verification progress (always visible) ─────────────────────── */}
      <section className="px-4 mt-4">
        <div className="rounded-2xl border bg-card p-4 card-lift">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-primary" /> Verification progress
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {verifiedCount} of {REQUIRED_TYPES.length} documents verified
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gradient-saffron leading-none">{progressPct}%</div>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-amber-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {!data.profile.approvedAt && verifiedCount < REQUIRED_TYPES.length && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
              <span>Submit + verify all KYC documents to start accepting orders.</span>
            </div>
          )}
        </div>
      </section>

      {/* ── Sticky tab bar ─────────────────────────────────────────────── */}
      <nav
        aria-label="Profile sections"
        className="sticky top-14 z-20 -mx-0 mt-4 bg-background/95 backdrop-blur border-b"
      >
        <div className="px-4 py-2 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`min-h-11 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap tap-press transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
                aria-pressed={active}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Active panel ───────────────────────────────────────────────── */}
      <div className="px-4 mt-4">
        {tab === 'personal' && <PersonalPanel data={data} />}
        {tab === 'vehicle' && <VehiclePanel data={data} />}
        {tab === 'documents' && <DocumentsPanel data={data} />}
        {tab === 'payouts' && <PayoutsPanel data={data} />}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Hero bits
// ────────────────────────────────────────────────────────────────────────────

function OnlinePill({ online, approvedAt }: { online: boolean; approvedAt: string | null }) {
  if (!approvedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px] font-medium">
        <Clock className="size-3" /> Pending approval
      </span>
    );
  }
  return online ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 text-success px-2 py-0.5 text-[10px] font-medium">
      <span className="size-1.5 rounded-full bg-success pulse-soft" /> Online
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-medium">
      <span className="size-1.5 rounded-full bg-muted-foreground" /> Offline
    </span>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card/80 backdrop-blur p-2.5">
      <div className="text-muted-foreground mx-auto inline-flex items-center justify-center">
        <Icon className="size-4" />
      </div>
      <div className="text-base font-bold font-mono leading-tight mt-0.5">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Personal tab
// ────────────────────────────────────────────────────────────────────────────

function PersonalPanel({ data }: { data: ProfileData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(data.user.name ?? '');
  const [email, setEmail] = useState(data.user.email ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi' | 'kn' | 'te'>('en');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/rider/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          email: email.trim() || null,
          emergencyPhone: emergencyPhone.trim() || null,
          preferredLanguage: language,
        }),
      });
      if (!r.ok) {
        let msg = `Failed (HTTP ${r.status})`;
        try {
          const j = await r.json();
          if (j?.error && typeof j.error === 'string') msg = j.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      toast.success('Profile updated');
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 reveal">
      <Row icon={UserIcon} label="Name" value={data.user.name || '—'} />
      <Row icon={Phone} label="Phone" value={data.user.phone || '—'} hint="Used to sign in — contact support to change." readOnly />

      {!editing ? (
        <>
          <Row icon={Mail} label="Email" value={data.user.email || 'Not set'} />
          <Row icon={Phone} label="Emergency contact" value="—" hint="In case we can't reach you on your primary number." />
          <Row icon={Languages} label="Language" value="English" />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium hover:bg-accent tap-press"
          >
            <Pencil className="size-4" /> Edit personal info
          </button>
        </>
      ) : (
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Display name</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Email</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Emergency contact phone</div>
            <input
              type="tel"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
              placeholder="+91 9xxxx xxxxx"
              inputMode="tel"
              className="w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Preferred language</div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as typeof language)}
              className="w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
              <option value="kn">ಕನ್ನಡ (Kannada)</option>
              <option value="te">తెలుగు (Telugu)</option>
            </select>
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex-1 min-h-11 inline-flex items-center justify-center rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60 tap-press"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 min-h-11 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 tap-press"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Vehicle tab
// ────────────────────────────────────────────────────────────────────────────

function VehiclePanel({ data }: { data: ProfileData }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-3 reveal">
      <Row icon={Bike} label="Vehicle type" value={prettyVehicleType(data.profile.vehicleType)} />
      <Row icon={Car} label="Vehicle number" value={data.profile.vehicleNumber || '—'} mono />

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        <div className="font-semibold flex items-center gap-1.5">
          <AlertCircle className="size-3.5" /> Changing vehicle info needs admin review
        </div>
        <p className="mt-1 opacity-90">
          For safety, edits to your vehicle type or number are reviewed before they go live.
        </p>
      </div>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full min-h-11 inline-flex items-center justify-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium hover:bg-accent tap-press"
        >
          <Pencil className="size-4" /> Request vehicle update
        </button>
      ) : (
        <div className="rounded-2xl border bg-card p-4 space-y-3 text-xs">
          <p className="text-muted-foreground">
            Vehicle edits aren't self-service. Contact rider support or upload an updated Vehicle RC
            from the Documents tab to begin the change request.
          </p>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="w-full min-h-11 inline-flex items-center justify-center rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-accent tap-press"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

function prettyVehicleType(t: string): string {
  return t.charAt(0) + t.slice(1).toLowerCase();
}

// ────────────────────────────────────────────────────────────────────────────
// Payouts tab (placeholder)
// ────────────────────────────────────────────────────────────────────────────

function PayoutsPanel({ data }: { data: ProfileData }) {
  return (
    <div className="space-y-3 reveal">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="size-4 text-primary" /> Earnings to date
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Earned</div>
            <div className="font-mono text-lg font-bold">{inrFull(data.profile.totalEarnings)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tips</div>
            <div className="font-mono text-lg font-bold">{inrFull(data.profile.totalTips)}</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-muted/20 p-4 text-xs">
        <div className="font-semibold flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-muted-foreground" /> Payout rule
        </div>
        <p className="text-muted-foreground mt-1">
          Your payout rate is controlled by the platform. View your full statement and per-trip
          breakdown on the earnings page.
        </p>
        <a
          href="/rider/earnings"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground tap-press"
        >
          Open earnings <ChevronRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Documents tab
// ────────────────────────────────────────────────────────────────────────────

function DocumentsPanel({ data }: { data: ProfileData }) {
  // Build a stable lookup by type — most recent submission wins if dupes ever leak.
  const byType: Partial<Record<ClientDocType, DocWire>> = useMemo(() => {
    const map: Partial<Record<ClientDocType, DocWire>> = {};
    for (const d of data.documents) {
      const cur = map[d.type];
      if (!cur || Date.parse(d.submittedAt) > Date.parse(cur.submittedAt)) {
        map[d.type] = d;
      }
    }
    return map;
  }, [data.documents]);

  return (
    <div className="space-y-3 reveal-stagger reveal">
      {REQUIRED_TYPES.map((type) => (
        <DocCard key={type} type={type} doc={byType[type]} />
      ))}
    </div>
  );
}

function DocCard({ type, doc }: { type: ClientDocType; doc: DocWire | undefined }) {
  const [open, setOpen] = useState(false);
  const Icon = TYPE_ICON[type];
  const label = TYPE_LABEL[type];

  // State derivation: collapses doc.status + doc.verifierStatus into one of
  // the six visual states the brief lists.
  const state = computeCardState(doc);

  // Wrap the entire card in a clickable surface when there's no doc — easier
  // tap target for "Upload" than a tiny CTA button.
  const isEmpty = !doc;

  return (
    <>
      <article
        aria-labelledby={`doc-${type}-title`}
        className={`rounded-2xl border overflow-hidden card-lift transition-colors ${tonalClass(state.tone)} ${
          isEmpty ? 'border-dashed border-2' : ''
        }`}
      >
        <header className="flex items-center gap-3 px-4 py-3 border-b bg-card/60">
          <div className={`grid size-9 place-items-center rounded-lg shrink-0 ${state.iconBg}`}>
            <Icon className="size-4" />
          </div>
          <h3 id={`doc-${type}-title`} className="flex-1 min-w-0 text-sm font-semibold truncate">
            {label}
          </h3>
          <StatusChip tone={state.tone} icon={state.chipIcon} text={state.chipText} />
        </header>

        <div className="p-4 space-y-3">
          {isEmpty ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-full min-h-11 flex flex-col items-center justify-center gap-2 py-4 text-muted-foreground tap-press"
              aria-label={`Upload ${label}`}
            >
              <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <Upload className="size-5" />
              </div>
              <div className="text-xs font-medium">{TYPE_HELPER[type]}</div>
              <div className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
                <Upload className="size-3.5" /> Upload
              </div>
            </button>
          ) : (
            <DocBody doc={doc!} state={state} onReplace={() => setOpen(true)} />
          )}
        </div>
      </article>

      {open && (
        <UploadSheet
          type={type}
          existingId={doc?.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Per-card body for non-empty states (verifying / approved / rejected / error / pending).
function DocBody({
  doc,
  state,
  onReplace,
}: {
  doc: DocWire;
  state: CardState;
  onReplace: () => void;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  async function reverify() {
    setRetrying(true);
    try {
      const r = await fetch(`/api/rider/kyc/${encodeURIComponent(doc.id)}/reverify`, {
        method: 'POST',
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `Re-verify failed (HTTP ${r.status})`);
      }
      toast.success('Re-verification submitted');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Re-verify failed');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      {/* Verifying spinner state — no body data yet, just spinner + masked num */}
      {state.kind === 'verifying' && (
        <div className="flex items-center gap-3 text-xs">
          <Loader2 className="size-4 animate-spin text-primary" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Verifying with {prettyProvider(doc.verifierProvider)}…</div>
            <div className="font-mono text-muted-foreground mt-0.5">{mask(doc.numberLast4 ?? '')}</div>
          </div>
        </div>
      )}

      {state.kind !== 'verifying' && (
        <dl className="text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Number</dt>
            <dd className="font-mono tracking-wide">{mask(doc.numberLast4 ?? '')}</dd>
          </div>
          {doc.expiresOn && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{fmtDay(doc.expiresOn)}</dd>
            </div>
          )}
          {state.kind === 'approved' && doc.verifiedAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Verified</dt>
              <dd>
                Verified by {prettyProvider(doc.verifierProvider)} · {relTimeShort(doc.verifiedAt)}
              </dd>
            </div>
          )}
          {state.kind === 'pending' && doc.submittedAt && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Submitted</dt>
              <dd>{relTimeShort(doc.submittedAt)}</dd>
            </div>
          )}
        </dl>
      )}

      {/* State-specific banners */}
      {state.kind === 'rejected' && (doc.rejectionReason || doc.verifierMessage) && (
        <p className="text-xs italic opacity-90 leading-relaxed">
          “{doc.rejectionReason || doc.verifierMessage}”
        </p>
      )}
      {state.kind === 'error' && (
        <p className="text-xs leading-relaxed">
          We couldn't reach the verifier. It usually clears within a minute — tap retry below.
        </p>
      )}

      {/* CTAs — vary per state */}
      <div className="flex flex-wrap gap-2 pt-1">
        {state.kind === 'rejected' && (
          <>
            <button
              type="button"
              onClick={reverify}
              disabled={retrying}
              className="min-h-11 min-w-11 flex-1 inline-flex items-center justify-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-60 tap-press"
            >
              {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Re-verify
            </button>
            <button
              type="button"
              onClick={onReplace}
              className="min-h-11 min-w-11 flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground tap-press"
            >
              <Upload className="size-3.5" /> Replace
            </button>
          </>
        )}
        {state.kind === 'error' && (
          <button
            type="button"
            onClick={reverify}
            disabled={retrying}
            className="min-h-11 min-w-11 w-full inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground tap-press"
          >
            {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Retry verification
          </button>
        )}
        {state.kind === 'approved' && (
          <button
            type="button"
            onClick={onReplace}
            className="min-h-11 min-w-11 w-full inline-flex items-center justify-center gap-1 rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-accent tap-press"
          >
            <Pencil className="size-3.5" /> View / Replace
          </button>
        )}
        {state.kind === 'pending' && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 w-full">
            <Clock className="size-3" /> We'll notify you once review is complete (usually within a day).
          </p>
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Upload sheet (full-screen on mobile)
// ────────────────────────────────────────────────────────────────────────────

function UploadSheet({
  type,
  existingId,
  onClose,
}: {
  type: ClientDocType;
  existingId: string | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const rules = CLIENT_RULES[type];
  const wantsPreview = type === 'PAN_CARD' || type === 'DRIVING_LICENSE';

  const [number, setNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Live-preview verification (PAN/DL only). Debounced ≥600ms after last keystroke.
  const [preview, setPreview] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'pass'; provider: string }
    | { kind: 'fail'; reason: string }
    | { kind: 'error'; reason: string }
  >({ kind: 'idle' });

  const formatOk = isFormatValid(type, number);

  useEffect(() => {
    if (!wantsPreview) return;
    if (!formatOk) {
      setPreview({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setPreview({ kind: 'pending' });
      try {
        const r = await fetch('/api/rider/profile/preview-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, rawNumber: normalizeNumber(type, number) }),
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (j?.status === 'PASS') {
          setPreview({ kind: 'pass', provider: j.provider ?? 'verifier' });
        } else if (j?.status === 'FAIL') {
          setPreview({ kind: 'fail', reason: j.reason || 'Not found in records — double-check the number.' });
        } else if (j?.status === 'ERROR') {
          setPreview({ kind: 'error', reason: j.reason || 'Verifier temporarily unavailable.' });
        } else {
          // UNSUPPORTED → silently treat as idle; user can still upload.
          setPreview({ kind: 'idle' });
        }
      } catch (e) {
        if ((e as any).name === 'AbortError') return;
        setPreview({ kind: 'error', reason: 'Could not reach verifier.' });
      }
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [number, type, formatOk, wantsPreview]);

  function pickFile(f: File | null) {
    setFileError(null);
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      setFileError(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB. Max is 8 MB.`);
      return;
    }
    if (!/^(image\/(jpeg|png|webp))|application\/pdf$/i.test(f.type)) {
      setFileError(
        type === 'VEHICLE_INSURANCE'
          ? 'Insurance certificates must be PDF or image.'
          : 'Use a PDF or image (JPG, PNG, WebP).'
      );
      return;
    }
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    if (f.type.startsWith('image/')) {
      setFilePreview(URL.createObjectURL(f));
    } else {
      setFilePreview(null);
    }
  }

  function clearFile() {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(null);
    setFilePreview(null);
    setFileError(null);
  }

  useEffect(() => {
    return () => { if (filePreview) URL.revokeObjectURL(filePreview); };
  }, [filePreview]);

  async function submit() {
    setSubmitError(null);
    if (!formatOk) {
      setSubmitError(`Doesn't match expected format — ${rules.hint}.`);
      return;
    }
    if (!file) {
      setSubmitError('Please attach a file.');
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      // Replace flow: delete old doc row first so POST creates a fresh one.
      if (existingId) {
        const del = await fetch(`/api/rider/kyc/${encodeURIComponent(existingId)}`, { method: 'DELETE' });
        if (!del.ok) throw new Error(`Couldn't remove the old document (HTTP ${del.status}).`);
      }
      await new Promise<void>((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', type);
        fd.append('number', normalizeNumber(type, number));
        if (issuedOn) fd.append('issuedOn', issuedOn);
        if (expiresOn) fd.append('expiresOn', expiresOn);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/rider/kyc');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let msg = `HTTP ${xhr.status}`;
            try {
              const j = JSON.parse(xhr.responseText);
              if (j?.error || j?.message) msg = j.error || j.message;
            } catch { if (xhr.responseText) msg = xhr.responseText.slice(0, 200); }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error('Network error.'));
        xhr.send(fd);
      });
      toast.success(`${TYPE_LABEL[type]} uploaded`);
      onClose();
      router.refresh();
    } catch (e) {
      setSubmitError((e as Error).message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 top-0 sm:top-auto z-50 flex flex-col bg-card sm:rounded-t-3xl shadow-2xl border-t outline-none max-w-md mx-auto data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          {/* Sheet header */}
          <header className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
            <div>
              <DialogPrimitive.Title className="display text-lg font-semibold">
                Upload {TYPE_LABEL[type]}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-[11px] text-muted-foreground">
                Number + a clear photo or scan. We mask everything except the last 4 digits.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="ml-auto rounded-full p-2 -mr-2 text-muted-foreground hover:bg-accent min-h-11 min-w-11 inline-flex items-center justify-center"
              aria-label="Close"
              disabled={busy}
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          {/* Scroll body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Number field with inline format + preview-verify feedback */}
            <label className="block">
              <div className="text-xs font-medium mb-1.5">Document number</div>
              <div className="relative">
                <input
                  type="text"
                  inputMode={rules.numeric ? 'numeric' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={rules.maxLength}
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder={rules.placeholder}
                  className={`w-full min-h-11 rounded-lg border bg-card pl-3 pr-10 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 ${
                    number.length === 0
                      ? 'border-border'
                      : formatOk
                      ? 'border-success/60'
                      : 'border-destructive/60'
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {number.length === 0 ? null : formatOk ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <XCircle className="size-4 text-destructive" />
                  )}
                </div>
              </div>
              <p
                className={`mt-1 text-[11px] ${
                  number.length > 0 && !formatOk ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {number.length > 0 && !formatOk ? `Doesn't match expected format — ${rules.hint}.` : rules.hint}
              </p>

              {/* Live preview verify for PAN/DL */}
              {wantsPreview && formatOk && (
                <div
                  className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 ${
                    preview.kind === 'pass'
                      ? 'border-success/30 bg-success/10 text-success'
                      : preview.kind === 'fail'
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : preview.kind === 'error'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'border-border bg-muted/40 text-muted-foreground'
                  }`}
                  aria-live="polite"
                >
                  {preview.kind === 'pending' && (
                    <>
                      <Loader2 className="size-3 animate-spin" /> Verifying…
                    </>
                  )}
                  {preview.kind === 'pass' && (
                    <>
                      <CheckCircle2 className="size-3" /> Looks valid ({prettyProvider(preview.provider)})
                    </>
                  )}
                  {preview.kind === 'fail' && (
                    <>
                      <XCircle className="size-3" /> {preview.reason}
                    </>
                  )}
                  {preview.kind === 'error' && (
                    <>
                      <AlertCircle className="size-3" /> {preview.reason}
                    </>
                  )}
                </div>
              )}
            </label>

            {/* Dates — issuedOn always offered; expiresOn for non-Aadhaar */}
            <div className="grid grid-cols-2 gap-2">
              {(type === 'DRIVING_LICENSE' || type === 'VEHICLE_INSURANCE' || type === 'VEHICLE_RC' || type === 'PAN_CARD') && (
                <label className="block">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1">Issued on</div>
                  <input
                    type="date"
                    value={issuedOn}
                    onChange={(e) => setIssuedOn(e.target.value)}
                    className="w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              )}
              {(type === 'DRIVING_LICENSE' || type === 'VEHICLE_INSURANCE' || type === 'VEHICLE_RC') && (
                <label className="block">
                  <div className="text-[11px] font-medium text-muted-foreground mb-1">Expires on</div>
                  <input
                    type="date"
                    value={expiresOn}
                    onChange={(e) => setExpiresOn(e.target.value)}
                    className="w-full min-h-11 rounded-lg border bg-card px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </label>
              )}
            </div>

            {/* File picker */}
            <div>
              <div className="text-xs font-medium mb-1.5">Document file</div>
              {!file ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="w-full min-h-[7rem] rounded-xl border-2 border-dashed border-border bg-muted/20 hover:border-primary hover:bg-primary/5 transition-colors tap-press flex flex-col items-center justify-center gap-1.5 text-muted-foreground p-4"
                >
                  <div className="grid size-10 place-items-center rounded-full bg-card shadow-sm">
                    <Upload className="size-4" />
                  </div>
                  <div className="text-xs font-medium">Tap to choose a file</div>
                  <div className="text-[10px]">PDF, JPG, PNG or WebP · max 8 MB</div>
                </button>
              ) : (
                <div className="rounded-xl border bg-card p-3 flex items-center gap-3">
                  <div className="size-16 shrink-0 rounded-lg overflow-hidden border bg-muted/40 relative grid place-items-center text-muted-foreground">
                    {filePreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={filePreview} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <FileText className="size-7" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-xs">
                    <div className="font-medium truncate flex items-center gap-1">
                      {!filePreview && <span aria-hidden>📄</span>}
                      <span className="truncate">{file.name}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type.split('/')[1]?.toUpperCase() || 'FILE'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="min-h-11 min-w-11 rounded-full text-muted-foreground hover:bg-accent grid place-items-center"
                    aria-label="Remove file"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0] ?? null);
                  if (e.target) e.target.value = '';
                }}
              />
              {fileError && (
                <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2 flex items-start gap-2">
                  <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div>{fileError}</div>
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      className="mt-1 underline font-medium"
                    >
                      Choose a different one
                    </button>
                  </div>
                </div>
              )}
            </div>

            {submitError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2 flex items-start gap-2" role="alert">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                {submitError}
              </div>
            )}
          </div>

          {/* Sticky bottom CTA with iOS safe-area inset */}
          <footer
            className="border-t bg-card px-4 pt-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
          >
            <button
              type="button"
              onClick={submit}
              disabled={busy || !formatOk || !file}
              className="w-full min-h-12 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 tap-press"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {progress > 0 ? `Uploading ${progress}%` : 'Preparing…'}
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  {existingId ? 'Replace document' : `Submit ${TYPE_LABEL[type]}`}
                </>
              )}
            </button>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared row + state helpers
// ────────────────────────────────────────────────────────────────────────────

function Row({
  icon: Icon,
  label,
  value,
  hint,
  readOnly,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  readOnly?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-3 flex items-start gap-3">
      <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          {label}
          {readOnly && (
            <span className="rounded-full bg-muted text-muted-foreground px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal">
              read-only
            </span>
          )}
        </div>
        <div className={`text-sm font-medium truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

type CardTone = 'muted' | 'primary' | 'success' | 'danger' | 'warning';
interface CardState {
  kind: 'empty' | 'verifying' | 'approved' | 'rejected' | 'error' | 'pending';
  tone: CardTone;
  chipIcon: LucideIcon;
  chipText: string;
  iconBg: string;
}

function computeCardState(doc: DocWire | undefined): CardState {
  if (!doc) {
    return {
      kind: 'empty',
      tone: 'muted',
      chipIcon: Upload,
      chipText: 'Not uploaded',
      iconBg: 'bg-muted text-muted-foreground',
    };
  }
  if (doc.status === 'APPROVED') {
    return {
      kind: 'approved',
      tone: 'success',
      chipIcon: CheckCircle2,
      chipText: 'Verified',
      iconBg: 'bg-success/15 text-success',
    };
  }
  if (doc.status === 'REJECTED' || doc.verifierStatus === 'FAIL') {
    return {
      kind: 'rejected',
      tone: 'danger',
      chipIcon: XCircle,
      chipText: 'Rejected',
      iconBg: 'bg-destructive/15 text-destructive',
    };
  }
  // PENDING + verifier in flight or ERROR
  if (doc.verifierStatus === 'ERROR') {
    return {
      kind: 'error',
      tone: 'warning',
      chipIcon: AlertCircle,
      chipText: "Couldn't verify",
      iconBg: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    };
  }
  // PAN/DL + still no verifier outcome → showing the live "Verifying…" state.
  if ((doc.type === 'PAN_CARD' || doc.type === 'DRIVING_LICENSE') && !doc.verifierStatus) {
    return {
      kind: 'verifying',
      tone: 'primary',
      chipIcon: Loader2,
      chipText: 'Verifying',
      iconBg: 'bg-primary/15 text-primary',
    };
  }
  // Default PENDING — awaiting admin review (Insurance/RC)
  return {
    kind: 'pending',
    tone: 'warning',
    chipIcon: Clock,
    chipText: 'Awaiting review',
    iconBg: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  };
}

function tonalClass(tone: CardTone): string {
  switch (tone) {
    case 'success': return 'border-success/30 bg-success/5';
    case 'danger':  return 'border-destructive/30 bg-destructive/5';
    case 'warning': return 'border-amber-500/30 bg-amber-500/5';
    case 'primary': return 'border-primary/30 bg-primary/5';
    case 'muted':
    default:        return 'border-border bg-card';
  }
}

function StatusChip({ tone, icon: Icon, text }: { tone: CardTone; icon: LucideIcon; text: string }) {
  const cls =
    tone === 'success' ? 'bg-success/10 text-success border-success/30'
    : tone === 'danger' ? 'bg-destructive/10 text-destructive border-destructive/30'
    : tone === 'warning' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
    : tone === 'primary' ? 'bg-primary/10 text-primary border-primary/30'
    : 'bg-muted text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0 ${cls}`}>
      <Icon className={`size-3 ${text === 'Verifying' ? 'animate-spin' : ''}`} aria-hidden />
      {text}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny formatters
// ────────────────────────────────────────────────────────────────────────────

function inrCompact(n: number): string {
  // ₹1.2k / ₹12.4k / ₹1.4L — keeps the hero stat strip compact.
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}

function inrFull(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t));
}

function relTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function prettyProvider(p: string | null | undefined): string {
  if (!p) return 'verifier';
  if (p === 'mock') return 'Mock';
  if (p === 'karza') return 'Karza';
  if (p === 'surepass') return 'Surepass';
  if (p === 'signzy') return 'Signzy';
  if (p === 'format-check') return 'format check';
  return p;
}
