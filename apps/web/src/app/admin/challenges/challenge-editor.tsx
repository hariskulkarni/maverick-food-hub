'use client';
/**
 * Challenge editor — create / edit dialog.
 *
 * Sections:
 *   1. Identity         — name, description, priority, isActive
 *   2. Type             — radio for the 5 ChallengeType values, with per-type
 *                          helper hints and a dynamic "Target" input label.
 *   3. Window           — radio for LIFETIME / MONTHLY / WEEKLY / CUSTOM.
 *                          When CUSTOM, validFrom/validTo datetime-local inputs
 *                          appear and gate the challenge's run range.
 *   4. Min order value  — optional spend gate per qualifying order.
 *   5. Reward           — radio for FIXED_OFF / PERCENT_OFF / FREE_DELIVERY.
 *                          PERCENT_OFF additionally exposes "max discount".
 *                          FREE_DELIVERY hides the reward-value input and
 *                          shows a "ride is on us" hint.
 *   6. Reward validity  — days the auto-issued coupon remains valid.
 *   7. Fraud prevention — perCustomerLimit, phoneVerifiedOnly switch (with
 *                          warning when turned off), optional totalLimit cap.
 *   8. Live preview     — "If 100 customers complete this, max cost is ₹X".
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Save, Trash2, AlertTriangle, Info, Trophy, Gift, Shield, Calculator
} from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import type {
  Challenge, ChallengeType, ChallengeWindow, ChallengeRewardType
} from './challenges-client';

type Draft = {
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  type: ChallengeType;
  target: number;
  window: ChallengeWindow;
  minOrderValue: number;
  rewardType: ChallengeRewardType;
  rewardValue: number;
  rewardMaxDiscount: number;
  rewardValidityDays: number;
  validFrom: string;
  validTo: string;
  perCustomerLimit: number;
  phoneVerifiedOnly: boolean;
  totalLimit: number;
};

const TYPE_HINTS: Record<ChallengeType, string> = {
  ORDER_COUNT:     'Customer completes N delivered orders within the window.',
  SPEND_THRESHOLD: 'Customer spends ≥ ₹X within the window.',
  CUISINE_VARIETY: 'Customer orders from N distinct cuisines.',
  WEEKEND_STREAK:  'Customer places ≥1 order on N consecutive weekends.',
  FIRST_N_ORDERS:  "Applies to a customer's first N orders, lifetime."
};

const TARGET_LABEL: Record<ChallengeType, string> = {
  ORDER_COUNT:     'Orders',
  SPEND_THRESHOLD: 'Amount (₹)',
  CUISINE_VARIETY: 'Distinct cuisines',
  WEEKEND_STREAK:  'Weekends in a row',
  FIRST_N_ORDERS:  'Orders'
};

const REWARD_HINTS: Record<ChallengeRewardType, string> = {
  FIXED_OFF:     'Flat ₹ off the next order — straight-up discount.',
  PERCENT_OFF:   'X% off, optionally capped to a max ₹ discount.',
  FREE_DELIVERY: 'Skip the delivery fee on the next order — the ride is on us.'
};

function emptyDraft(seed: Partial<Challenge> = {}): Draft {
  return {
    name: seed.name ?? '',
    description: seed.description ?? '',
    priority: seed.priority ?? 0,
    isActive: seed.isActive ?? true,
    type: (seed.type ?? 'ORDER_COUNT') as ChallengeType,
    target: seed.target ?? 5,
    window: (seed.window ?? 'LIFETIME') as ChallengeWindow,
    minOrderValue: Number(seed.minOrderValue ?? 0),
    rewardType: (seed.rewardType ?? 'FIXED_OFF') as ChallengeRewardType,
    rewardValue: Number(seed.rewardValue ?? 100),
    rewardMaxDiscount: Number(seed.rewardMaxDiscount ?? 0),
    rewardValidityDays: seed.rewardValidityDays ?? 30,
    validFrom: toLocalDateTime(seed.validFrom) || toLocalDateTime(new Date()),
    validTo: toLocalDateTime(seed.validTo),
    perCustomerLimit: seed.perCustomerLimit ?? 1,
    phoneVerifiedOnly: seed.phoneVerifiedOnly ?? true,
    totalLimit: seed.totalLimit ?? 0
  };
}

export function ChallengeEditor({
  challenge, onClose
}: {
  challenge: Partial<Challenge>;
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !challenge.id;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(challenge));
  const [busy, setBusy] = useState(false);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // ── Cost preview ───────────────────────────────────────────────────────
  // The headline "max cost if 100 customers complete this" reflects the worst
  // case for FIXED_OFF / PERCENT_OFF. FREE_DELIVERY's cost depends on the
  // delivery-fee config, so we mark it as "varies".
  const maxCostFor100 = useMemo(() => {
    if (draft.rewardType === 'FREE_DELIVERY') return null;
    if (draft.rewardType === 'PERCENT_OFF') {
      // We use the optional max-discount cap as the per-customer worst case.
      // Without a cap we can't bound it tightly — show "uncapped".
      if (draft.rewardMaxDiscount > 0) return 100 * draft.rewardMaxDiscount;
      return null;
    }
    return 100 * draft.rewardValue;
  }, [draft.rewardType, draft.rewardValue, draft.rewardMaxDiscount]);

  async function save() {
    if (!draft.name.trim() || draft.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (draft.target <= 0) {
      toast.error('Target must be a positive integer');
      return;
    }
    if (draft.rewardType === 'FIXED_OFF' && draft.rewardValue <= 0) {
      toast.error('Reward amount must be greater than 0');
      return;
    }
    if (draft.rewardType === 'PERCENT_OFF' && (draft.rewardValue <= 0 || draft.rewardValue > 100)) {
      toast.error('Reward percentage must be between 1 and 100');
      return;
    }
    if (draft.rewardValidityDays < 1 || draft.rewardValidityDays > 365) {
      toast.error('Reward validity must be between 1 and 365 days');
      return;
    }
    if (!draft.validFrom) {
      toast.error('Valid-from is required');
      return;
    }
    if (draft.window === 'CUSTOM' && !draft.validTo) {
      toast.error('Custom windows require a Valid-until date');
      return;
    }
    setBusy(true);
    try {
      const body = buildBody(draft);
      const url = isNew ? '/api/admin/challenges' : `/api/admin/challenges/${challenge.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        await reportApiError(r, isNew ? 'Could not create challenge' : 'Could not save challenge');
        return;
      }
      toast.success(isNew ? 'Challenge created' : 'Challenge saved');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!challenge.id) return;
    if (!confirm(`Deactivate "${challenge.name}"? Customers stop earning new rewards immediately.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/challenges/${challenge.id}`, { method: 'DELETE' });
      if (!r.ok) {
        await reportApiError(r, 'Could not deactivate challenge');
        return;
      }
      toast.success('Challenge deactivated');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        <div className="p-6 pb-2">
          <DialogHeader>
            <DialogTitle>{isNew ? 'New challenge' : `Edit ${challenge.name}`}</DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 space-y-6">
          {/* ── 1. Identity ──────────────────────────────────────────── */}
          <Section title="Identity" icon={Trophy}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Challenge name"
                required
                value={draft.name}
                onChange={(v) => patch('name', v)}
                placeholder="e.g. First 5 Orders Reward"
              />
              <Field
                label="Priority (higher surfaces first)"
                type="number"
                value={String(draft.priority)}
                onChange={(v) => patch('priority', Number(v) || 0)}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={draft.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="Customer-facing copy — what they have to do, what they get."
              />
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Switch checked={draft.isActive} onCheckedChange={(v) => patch('isActive', v)} />
              <div>
                <div className="text-sm font-medium">{draft.isActive ? 'Active' : 'Inactive'}</div>
                <div className="text-[11px] text-muted-foreground">
                  Toggle off to suspend the challenge without losing its config or progress.
                </div>
              </div>
            </div>
          </Section>

          {/* ── 2. Type ──────────────────────────────────────────────── */}
          <Section title="Type" icon={Trophy}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(['ORDER_COUNT', 'SPEND_THRESHOLD', 'CUISINE_VARIETY', 'WEEKEND_STREAK', 'FIRST_N_ORDERS'] as ChallengeType[]).map((t) => (
                <RadioCard
                  key={t}
                  label={typeShort(t)}
                  hint={TYPE_HINTS[t]}
                  active={draft.type === t}
                  onClick={() => patch('type', t)}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label={TARGET_LABEL[draft.type]}
                type="number"
                required
                value={String(draft.target)}
                onChange={(v) => patch('target', Math.max(1, Math.floor(Number(v) || 0)))}
              />
              <Field
                label="Minimum order value (₹, optional)"
                type="number"
                value={String(draft.minOrderValue)}
                onChange={(v) => patch('minOrderValue', Math.max(0, Number(v) || 0))}
                help="Orders below this floor won't count toward the challenge. 0 = no floor."
              />
            </div>
          </Section>

          {/* ── 3. Window ────────────────────────────────────────────── */}
          <Section title="Window" icon={Calculator}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <RadioCard label="Lifetime" hint="Never resets"           active={draft.window === 'LIFETIME'} onClick={() => patch('window', 'LIFETIME')} />
              <RadioCard label="Monthly"  hint="Calendar month"          active={draft.window === 'MONTHLY'}  onClick={() => patch('window', 'MONTHLY')} />
              <RadioCard label="Weekly"   hint="Calendar week"           active={draft.window === 'WEEKLY'}   onClick={() => patch('window', 'WEEKLY')} />
              <RadioCard label="Custom"   hint="Fixed validFrom/validTo" active={draft.window === 'CUSTOM'}   onClick={() => patch('window', 'CUSTOM')} />
            </div>

            {/* Always show validFrom; validTo only required for CUSTOM but allowed always. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Valid from"
                type="datetime-local"
                required
                value={draft.validFrom}
                onChange={(v) => patch('validFrom', v)}
              />
              <Field
                label={draft.window === 'CUSTOM' ? 'Valid until (required)' : 'Valid until (optional)'}
                type="datetime-local"
                value={draft.validTo}
                onChange={(v) => patch('validTo', v)}
                help={draft.window === 'CUSTOM' ? 'CUSTOM windows are bounded by this date.' : 'Leave blank for no end.'}
              />
            </div>
          </Section>

          {/* ── 5. Reward ────────────────────────────────────────────── */}
          <Section title="Reward" icon={Gift}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <RadioCard label="Fixed off"     hint={REWARD_HINTS.FIXED_OFF}     active={draft.rewardType === 'FIXED_OFF'}     onClick={() => patch('rewardType', 'FIXED_OFF')} />
              <RadioCard label="Percent off"   hint={REWARD_HINTS.PERCENT_OFF}   active={draft.rewardType === 'PERCENT_OFF'}   onClick={() => patch('rewardType', 'PERCENT_OFF')} />
              <RadioCard label="Free delivery" hint={REWARD_HINTS.FREE_DELIVERY} active={draft.rewardType === 'FREE_DELIVERY'} onClick={() => patch('rewardType', 'FREE_DELIVERY')} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {draft.rewardType === 'FIXED_OFF' && (
                <Field
                  label="₹ off"
                  type="number"
                  required
                  value={String(draft.rewardValue)}
                  onChange={(v) => patch('rewardValue', Math.max(0, Number(v) || 0))}
                />
              )}
              {draft.rewardType === 'PERCENT_OFF' && (
                <>
                  <Field
                    label="% off"
                    type="number"
                    required
                    value={String(draft.rewardValue)}
                    onChange={(v) => patch('rewardValue', Math.min(100, Math.max(0, Number(v) || 0)))}
                  />
                  <Field
                    label="Max discount (₹, optional)"
                    type="number"
                    value={String(draft.rewardMaxDiscount)}
                    onChange={(v) => patch('rewardMaxDiscount', Math.max(0, Number(v) || 0))}
                    help="Caps the rupee discount so a customer can't game a big-cart percentage."
                  />
                </>
              )}
              {draft.rewardType === 'FREE_DELIVERY' && (
                <div className="rounded-md border bg-warning/5 p-3 text-xs text-warning flex items-start gap-2 md:col-span-2">
                  <Gift className="size-3.5 mt-0.5 shrink-0" />
                  <span>The ride is on us — delivery fee is fully waived on the customer's next order.</span>
                </div>
              )}
              <Field
                label="Reward validity (days)"
                type="number"
                required
                value={String(draft.rewardValidityDays)}
                onChange={(v) => patch('rewardValidityDays', Math.min(365, Math.max(1, Math.floor(Number(v) || 1))))}
                help="Days the auto-issued coupon code is valid for after completion."
              />
            </div>
          </Section>

          {/* ── 7. Fraud prevention ──────────────────────────────────── */}
          <Section title="Fraud prevention" icon={Shield}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Per-customer reward limit"
                type="number"
                value={String(draft.perCustomerLimit)}
                onChange={(v) => patch('perCustomerLimit', Math.max(1, Math.floor(Number(v) || 1)))}
                help="How many times the same customer can earn this reward. Default 1."
              />
              <Field
                label="Total rewards cap (optional)"
                type="number"
                value={String(draft.totalLimit)}
                onChange={(v) => patch('totalLimit', Math.max(0, Math.floor(Number(v) || 0)))}
                help="Hard ceiling on rewards across all customers. 0 = no cap."
              />
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Switch checked={draft.phoneVerifiedOnly} onCheckedChange={(v) => patch('phoneVerifiedOnly', v)} />
              <div className="flex-1">
                <div className="text-sm font-medium">Phone-verified customers only</div>
                <div className="text-[11px] text-muted-foreground">
                  Reject progress when the customer has no verified phone number. Strongly recommended.
                </div>
              </div>
            </div>
            {!draft.phoneVerifiedOnly && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  Phone verification is off — bad actors can spin up accounts to harvest rewards.
                  Only disable for closed-test challenges or when you have a stronger gate elsewhere.
                </span>
              </div>
            )}
          </Section>

          {/* ── 8. Cost preview ──────────────────────────────────────── */}
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Calculator className="size-4 text-primary" /> Cost preview
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Rough max cost if 100 customers complete this challenge.
            </div>
            <div className="mt-2 text-sm">
              {draft.rewardType === 'FREE_DELIVERY' ? (
                <span className="text-muted-foreground">Varies — depends on per-order delivery fees.</span>
              ) : maxCostFor100 == null ? (
                <span className="text-muted-foreground">Uncapped — add a max-discount cap to bound the cost.</span>
              ) : (
                <span>
                  Up to <span className="font-semibold text-primary">{money(maxCostFor100)}</span> for 100 completions
                  {draft.totalLimit > 0 ? `, hard-capped at ${draft.totalLimit} rewards total` : ''}.
                </span>
              )}
            </div>
          </div>

          {/* Audit callout */}
          <div className="rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <strong>Audit trail:</strong> every change writes an entry (
            <code>challenge.create</code> / <code>challenge.update</code> /{' '}
            <code>challenge.deactivate</code>) to the platform audit log, with the
            actor's user ID, role, IP, and a before/after JSON snapshot.
          </div>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 border-t bg-background p-4">
          <div>
            {!isNew && challenge.isActive && (
              <Button
                variant="outline"
                onClick={deactivate}
                disabled={busy}
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
              >
                <Trash2 className="size-4" /> Deactivate
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              <Save className="size-4" /> {busy ? 'Saving…' : (isNew ? 'Create challenge' : 'Save changes')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Building blocks ───────────────────────────────────────────────────────

function Section({
  title, icon: Icon, children
}: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground tracking-tight flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />} {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label, value, onChange, type = 'text', required = false, help, placeholder
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
}) {
  return (
    <div>
      {label && <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>}
      <Input
        className={label ? 'mt-1' : ''}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {help && <div className="text-[11px] text-muted-foreground mt-1">{help}</div>}
    </div>
  );
}

function RadioCard({
  label, hint, active, onClick
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-3 text-left transition-colors ${active ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function typeShort(t: ChallengeType): string {
  switch (t) {
    case 'ORDER_COUNT':     return 'Order count';
    case 'SPEND_THRESHOLD': return 'Spend threshold';
    case 'CUISINE_VARIETY': return 'Cuisine variety';
    case 'WEEKEND_STREAK':  return 'Weekend streak';
    case 'FIRST_N_ORDERS':  return 'First N orders';
  }
}

function buildBody(draft: Draft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    type: draft.type,
    target: draft.target,
    window: draft.window,
    minOrderValue: draft.minOrderValue > 0 ? draft.minOrderValue : null,
    rewardType: draft.rewardType,
    rewardValue: draft.rewardType === 'FREE_DELIVERY' ? 0 : draft.rewardValue,
    rewardMaxDiscount: draft.rewardType === 'PERCENT_OFF' && draft.rewardMaxDiscount > 0 ? draft.rewardMaxDiscount : null,
    rewardValidityDays: draft.rewardValidityDays,
    validFrom: draft.validFrom ? new Date(draft.validFrom).toISOString() : new Date().toISOString(),
    validTo: draft.validTo ? new Date(draft.validTo).toISOString() : null,
    priority: draft.priority,
    isActive: draft.isActive,
    perCustomerLimit: draft.perCustomerLimit,
    phoneVerifiedOnly: draft.phoneVerifiedOnly,
    totalLimit: draft.totalLimit > 0 ? draft.totalLimit : null
  };
}

function toLocalDateTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
