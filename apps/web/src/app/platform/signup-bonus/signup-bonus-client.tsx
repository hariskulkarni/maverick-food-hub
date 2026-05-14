'use client';
/**
 * Super-admin Signup Bonus editor.
 *
 *   - Status hero    : big toggle for isActive + 30-day issuance stats.
 *   - Bonus amount   : totalAmount + splitCount, computed "₹X × N = ₹Y total"
 *                      summary, optional perOrderCap override.
 *   - Eligibility    : minOrderValue floor.
 *   - Validity       : validityDays.
 *   - Abuse prev.    : phone / IP / device switches with helper text.
 *   - Recent grants  : 20 most-recent grants, with row-level Revoke action.
 *   - Audit reminder + sticky save footer.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Gift, Save, ShieldAlert, Calculator, Timer, Coins, History, Sparkles,
  AlertCircle, Smartphone, Wifi, Fingerprint
} from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { RevokeButton } from './revoke-button';

type Config = {
  id: string;
  isActive: boolean;
  totalAmount: string | number;
  splitCount: number;
  perOrderCap: string | number | null;
  minOrderValue: string | number | null;
  phoneCheckEnabled: boolean;
  ipCheckEnabled: boolean;
  deviceCheckEnabled: boolean;
  validityDays: number;
};

type Stats = {
  grantsIssued: number;
  totalCredited: number;
  totalUsed: number;
  revokedCount: number;
  refusedCount: number;
};

type GrantRow = {
  id: string;
  totalAmount: string | number;
  usedAmount: string | number;
  pendingAmount: string | number;
  remainingOrders: number;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  user: { id: string; name: string | null; phone: string | null; email: string | null };
};

export function SignupBonusClient({
  config, stats, recentGrants
}: {
  config: Config;
  stats: Stats;
  recentGrants: GrantRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Local editor state — Decimal strings come down as plain strings; coerce.
  const [isActive,           setIsActive]           = useState(config.isActive);
  const [totalAmount,        setTotalAmount]        = useState<number>(Number(config.totalAmount));
  const [splitCount,         setSplitCount]         = useState<number>(config.splitCount);
  const [perOrderCapOverride, setPerOrderCapOverride] = useState<number | ''>(
    config.perOrderCap == null ? '' : Number(config.perOrderCap)
  );
  const [minOrderValue,      setMinOrderValue]      = useState<number | ''>(
    config.minOrderValue == null ? '' : Number(config.minOrderValue)
  );
  const [phoneCheckEnabled,  setPhoneCheckEnabled]  = useState(config.phoneCheckEnabled);
  const [ipCheckEnabled,     setIpCheckEnabled]     = useState(config.ipCheckEnabled);
  const [deviceCheckEnabled, setDeviceCheckEnabled] = useState(config.deviceCheckEnabled);
  const [validityDays,       setValidityDays]       = useState<number>(config.validityDays);

  // Computed "₹X × N = ₹Y total" summary; falls back to even-split when
  // the override is blank.
  const computedPerOrder = useMemo(() => {
    if (perOrderCapOverride !== '' && perOrderCapOverride > 0) return Number(perOrderCapOverride);
    return Math.round((totalAmount / Math.max(1, splitCount)) * 100) / 100;
  }, [totalAmount, splitCount, perOrderCapOverride]);

  const computedTotalAtCap = useMemo(
    () => Math.round(computedPerOrder * splitCount * 100) / 100,
    [computedPerOrder, splitCount]
  );

  async function save() {
    if (!(totalAmount > 0)) return toast.error('Total amount must be positive');
    if (!(splitCount >= 1 && splitCount <= 20)) return toast.error('Split count must be 1–20');
    if (validityDays < 0 || validityDays > 730) return toast.error('Validity must be 0–730 days');

    setBusy(true);
    try {
      const r = await fetch('/api/platform/signup-bonus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive,
          totalAmount,
          splitCount,
          perOrderCap:  perOrderCapOverride === '' ? null : Number(perOrderCapOverride),
          minOrderValue: minOrderValue === '' ? null : Number(minOrderValue),
          phoneCheckEnabled,
          ipCheckEnabled,
          deviceCheckEnabled,
          validityDays
        })
      });
      if (!r.ok) return toast.error('Save failed: ' + (await r.text()));
      toast.success('Signup bonus config saved.');
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="p-6 max-w-6xl space-y-6 pb-28">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold flex items-center gap-2">
            <Gift className="size-7 text-primary" /> Signup bonus
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Reward new customers with a staggered credit they unlock over their first few orders.
            All changes here take effect for new sign-ups going forward — existing grants keep their original terms.
          </p>
        </div>
      </header>

      {/* ── Status hero ─────────────────────────────────────────── */}
      <Card className={isActive ? 'border-success/40 bg-gradient-to-br from-success/5 via-card to-card' : ''}>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`grid size-12 place-items-center rounded-xl ${isActive ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}>
                <Sparkles className="size-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-lg">{isActive ? 'Live — issuing on sign-up' : 'Paused — no new grants'}</h3>
                  {isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Off</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isActive
                    ? `New customers receive ${money(totalAmount)} over ${splitCount} orders.`
                    : 'Flip on to start issuing the signup credit again. Already-granted bonuses are untouched.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium">{isActive ? 'On' : 'Off'}</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat icon={Gift}  label="Grants · 30d"      value={stats.grantsIssued.toLocaleString()} tone="primary" />
            <Stat icon={Coins} label="Credit issued · 30d" value={money(stats.totalCredited)}        tone="primary" />
            <Stat icon={Coins} label="Credit used · 30d"   value={money(stats.totalUsed)}            tone="success" />
            <Stat icon={ShieldAlert} label="Revoked · 30d" value={stats.revokedCount.toLocaleString()} tone={stats.revokedCount > 0 ? 'warning' : 'muted'} />
            <Stat icon={ShieldAlert} label="Refused · 30d" value={stats.refusedCount.toLocaleString()} tone={stats.refusedCount > 0 ? 'warning' : 'muted'} />
          </div>
        </CardContent>
      </Card>

      {/* ── Bonus amount ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-primary" />
            <h3 className="font-semibold">Bonus amount</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            How much total credit to grant, and across how many orders it staggers. The per-order ceiling defaults
            to total÷orders, but you can override it (e.g. ₹100 total but only ₹15 per order).
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <NumField
              label="Total credit *"
              prefix="₹"
              value={totalAmount}
              setValue={setTotalAmount}
              hint="The full amount the customer will see across all their first orders."
            />
            <NumField
              label="Across how many orders *"
              suffix="orders"
              value={splitCount}
              setValue={(v) => setSplitCount(Math.max(1, Math.min(20, Math.round(v))))}
              hint="1–20. After this many delivered orders the bonus is exhausted."
              integer
            />
            <NumField
              label="Per-order cap (override)"
              prefix="₹"
              value={perOrderCapOverride === '' ? 0 : perOrderCapOverride}
              setValue={(v) => setPerOrderCapOverride(v > 0 ? v : '')}
              hint="Leave 0 to auto-compute (total ÷ orders)."
            />
          </div>

          {/* Computed summary */}
          <div className="rounded-lg border bg-primary/5 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold">{money(computedPerOrder)}</span>
            <span className="text-muted-foreground">per order ×</span>
            <span className="font-semibold">{splitCount}</span>
            <span className="text-muted-foreground">orders =</span>
            <span className="font-bold text-primary">{money(computedTotalAtCap)}</span>
            <span className="text-muted-foreground">max payout per customer</span>
            {computedTotalAtCap < totalAmount && (
              <Badge variant="warning" className="text-[10px]">
                Capped — {money(totalAmount - computedTotalAtCap)} of the grant is unreachable
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Eligibility floor + Validity ─────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Coins className="size-4 text-primary" />
              <h3 className="font-semibold">Eligibility floor</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Minimum cart subtotal before the bonus can apply to an order.
            </p>
            <NumField
              label="Min order value"
              prefix="₹"
              value={minOrderValue === '' ? 0 : minOrderValue}
              setValue={(v) => setMinOrderValue(v > 0 ? v : '')}
              hint="Leave 0 for no floor."
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Timer className="size-4 text-primary" />
              <h3 className="font-semibold">Validity</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              How long after sign-up the grant remains usable. 0 = never expires.
            </p>
            <NumField
              label="Validity"
              suffix="days"
              value={validityDays}
              setValue={(v) => setValidityDays(Math.max(0, Math.min(730, Math.round(v))))}
              hint="0–730. Typical: 90 days."
              integer
            />
          </CardContent>
        </Card>
      </div>

      {/* ── Abuse prevention ─────────────────────────────────── */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning" />
            <h3 className="font-semibold">Abuse prevention</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Refuse a grant when the new customer matches an attribute of an existing grant. Refusals are silent —
            the sign-up still succeeds, but no bonus is issued, and the event lands in the audit log.
          </p>
          <div className="space-y-3">
            <SwitchRow
              icon={Smartphone}
              label="Phone"
              hint="Refuse if same phone already received a grant"
              checked={phoneCheckEnabled}
              onChange={setPhoneCheckEnabled}
            />
            <SwitchRow
              icon={Wifi}
              label="IP address"
              hint="Refuse if same IP already received a grant (rejects shared coffee-shop wifi)"
              checked={ipCheckEnabled}
              onChange={setIpCheckEnabled}
            />
            <SwitchRow
              icon={Fingerprint}
              label="Device fingerprint"
              hint="Refuse if same device fingerprint matches (deferred — requires client-side fingerprinting)"
              checked={deviceCheckEnabled}
              onChange={setDeviceCheckEnabled}
              disabledHint="Client-side fingerprinting not yet wired up."
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Recent grants table ──────────────────────────────── */}
      <section>
        <h3 className="font-semibold flex items-center gap-2 mb-3"><History className="size-4 text-primary" /> Recent grants</h3>
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>Customer</Th>
                  <Th>Granted</Th>
                  <Th>Total</Th>
                  <Th>Used</Th>
                  <Th>Orders left</Th>
                  <Th>Expires</Th>
                  <Th>Status</Th>
                  <Th>{''}</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentGrants.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No grants issued yet.</td></tr>
                )}
                {recentGrants.map((g) => {
                  const total = Number(g.totalAmount);
                  const used  = Number(g.usedAmount);
                  const revoked = !!g.revokedAt;
                  const expired = g.expiresAt && new Date(g.expiresAt) < new Date();
                  return (
                    <tr key={g.id} className={revoked ? 'opacity-60' : ''}>
                      <td className="px-4 py-3">
                        <div className="font-medium truncate">{g.user.name ?? g.user.phone ?? g.user.email ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground">{g.user.phone ?? g.user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(g.createdAt, { dateStyle: 'medium' })}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{money(total)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{money(used)}</td>
                      <td className="px-4 py-3 text-xs">{g.remainingOrders}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {g.expiresAt ? fmtDate(g.expiresAt, { dateStyle: 'medium' }) : 'Never'}
                      </td>
                      <td className="px-4 py-3">
                        {revoked
                          ? <Badge variant="destructive" className="text-[10px]">Revoked</Badge>
                          : expired
                            ? <Badge variant="muted" className="text-[10px]">Expired</Badge>
                            : g.remainingOrders <= 0
                              ? <Badge variant="muted" className="text-[10px]">Exhausted</Badge>
                              : <Badge variant="success" className="text-[10px]">Active</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!revoked && <RevokeButton grantId={g.id} customerLabel={g.user.name ?? g.user.phone ?? 'this user'} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      </section>

      {/* ── Audit reminder ───────────────────────────────────── */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
        <span>
          Every change here writes a <code className="font-mono">signup_bonus.config.update</code> entry to the
          audit log with before/after snapshots. Revocations are logged separately and decrement the customer's
          remaining balance via the ledger.
        </span>
      </div>

      {/* ── Sticky save footer ───────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 lg:left-[240px] border-t bg-background/95 backdrop-blur z-30">
        <div className="max-w-6xl mx-auto p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground hidden md:block">
            Saving takes effect for the next sign-up. Existing grants are not retroactively re-priced.
          </p>
          <Button onClick={save} disabled={busy}>
            <Save className="size-4" /> {busy ? 'Saving…' : 'Save signup bonus config'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wider text-muted-foreground">{children}</th>;
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'success' | 'primary' | 'warning' | 'muted' }) {
  const cls =
    tone === 'success' ? 'bg-success/10 text-success border-success/30'    :
    tone === 'primary' ? 'bg-primary/10 text-primary border-primary/30'    :
    tone === 'warning' ? 'bg-warning/10 text-warning border-warning/30'    :
                         'bg-muted text-muted-foreground border';
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${cls}`}>
      <Icon className="size-5" />
      <div>
        <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
        <div className="font-bold text-base leading-none">{value}</div>
      </div>
    </div>
  );
}

function NumField({
  label, value, setValue, prefix, suffix, hint, integer
}: {
  label: string;
  value: number | string;
  setValue: (v: number) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  integer?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
        <Input
          type="number"
          step={integer ? 1 : 0.01}
          min={0}
          value={value === 0 || value === '' ? '' : value}
          onChange={(e) => setValue(e.target.value === '' ? 0 : Number(e.target.value))}
          placeholder="0"
          className={`${prefix ? 'pl-7' : ''} ${suffix ? 'pr-16' : ''}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchRow({
  icon: Icon, label, hint, checked, onChange, disabledHint
}: {
  icon: any;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabledHint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3 min-w-0">
        <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground shrink-0">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm">{label}</div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
          {disabledHint && (
            <div className="text-[10px] text-warning mt-0.5">{disabledHint}</div>
          )}
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
