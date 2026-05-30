'use client';
/**
 * Campaign editor dialog — create or edit a CouponCampaign.
 *
 * Sections:
 *   1. Identity     — name, description, codePrefix (auto-uppercase + alnum-only).
 *   2. Channel      — radio cards: "Dine-in → Online" vs "Online → Dine-in".
 *   3. Discount     — PERCENTAGE / FIXED radio with conditional maxDiscount field.
 *   4. Eligibility  — minOrderAmount, perUserLimit, maxUses.
 *   5. Validity     — validFrom, expiresAt.
 *   6. Distribution — distributedCount, used as conversion-rate denominator.
 *   7. Live preview — sample receipt/email snippet matching the channel.
 *
 * The POST endpoint creates the campaign + sibling Offer in one transaction.
 * PATCH only allows non-destructive edits (name, description, distributedCount,
 * status) — discount/channel/code are immutable post-creation (changing them
 * would break the link with the existing redeemed Offer).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Mail, Smartphone, Utensils, Trash2, Info, IndianRupee, Percent } from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import { reportApiError } from '@/lib/api-error';
import type { CampaignRow, CampaignChannel } from './campaigns-client';

type DiscountType = 'PERCENTAGE' | 'FIXED';

type Draft = {
  name: string;
  description: string;
  codePrefix: string;
  channel: CampaignChannel;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount: number;
  minOrderAmount: number;
  perUserLimit: number;
  maxUses: number;
  validFrom: string;
  expiresAt: string;
  distributedCount: number;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED';
};

function toLocalDateTime(d: string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '';
  const off = date.getTimezoneOffset();
  const local = new Date(date.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

function emptyDraft(seed: CampaignRow | null): Draft {
  return {
    name: seed?.name ?? '',
    description: seed?.description ?? '',
    codePrefix: seed?.codePrefix ?? '',
    channel: seed?.channel ?? 'DINE_IN_TO_ONLINE',
    discountType: ((seed?.discountType as DiscountType) ?? 'PERCENTAGE'),
    discountValue: Number(seed?.discountValue ?? 0),
    maxDiscount: Number(seed?.maxDiscount ?? 0),
    minOrderAmount: Number(seed?.minOrderAmount ?? 0),
    perUserLimit: seed?.perUserLimit ?? 1,
    maxUses: seed?.maxUses ?? 0,
    validFrom: toLocalDateTime(seed?.validFrom),
    expiresAt: toLocalDateTime(seed?.expiresAt),
    distributedCount: seed?.distributedCount ?? 0,
    status: seed?.status ?? 'ACTIVE'
  };
}

export function CampaignEditor({
  campaign,
  onClose
}: {
  campaign: CampaignRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !campaign;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(campaign));
  const [busy, setBusy] = useState(false);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!draft.name.trim() || draft.name.trim().length < 2) {
      toast.error('Name is required (min 2 characters)');
      return;
    }
    if (isNew && (!draft.codePrefix || draft.codePrefix.length < 2)) {
      toast.error('Code prefix is required (min 2 characters)');
      return;
    }
    if (isNew && !/^[A-Z0-9]+$/.test(draft.codePrefix)) {
      toast.error('Code prefix must be uppercase alphanumeric only');
      return;
    }
    if (isNew && draft.discountValue <= 0) {
      toast.error('Discount value must be greater than 0');
      return;
    }
    if (
      isNew &&
      draft.discountType === 'PERCENTAGE' &&
      draft.discountValue > 100
    ) {
      toast.error('Percentage discount cannot exceed 100');
      return;
    }

    setBusy(true);
    try {
      if (isNew) {
        const body = {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          codePrefix: draft.codePrefix,
          channel: draft.channel,
          discountType: draft.discountType,
          discountValue: draft.discountValue,
          maxDiscount: draft.discountType === 'PERCENTAGE' && draft.maxDiscount > 0 ? draft.maxDiscount : null,
          minOrderAmount: draft.minOrderAmount > 0 ? draft.minOrderAmount : null,
          maxUses: draft.maxUses > 0 ? draft.maxUses : null,
          perUserLimit: Math.max(1, draft.perUserLimit),
          distributedCount: Math.max(0, draft.distributedCount),
          validFrom: draft.validFrom ? new Date(draft.validFrom).toISOString() : null,
          expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null
        };
        const r = await fetch('/api/admin/coupon-campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!r.ok) {
          await reportApiError(r, 'Could not create campaign');
          return;
        }
        toast.success('Campaign created');
      } else {
        const body = {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          distributedCount: Math.max(0, draft.distributedCount),
          status: draft.status
        };
        const r = await fetch(`/api/admin/coupon-campaigns/${campaign!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!r.ok) {
          await reportApiError(r, 'Could not save campaign');
          return;
        }
        toast.success('Campaign saved');
      }
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!campaign) return;
    if (!confirm('Deactivate this campaign? The linked coupon stops working immediately. Past redemptions stay intact.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/coupon-campaigns/${campaign.id}`, { method: 'DELETE' });
      if (!r.ok) {
        await reportApiError(r, 'Could not deactivate campaign');
        return;
      }
      toast.success('Campaign deactivated');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const previewCode = campaign?.offer?.code ?? draft.codePrefix;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New coupon campaign' : `Edit ${campaign!.name}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 1. Identity */}
          <Section title="Identity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Internal name"
                required
                value={draft.name}
                onChange={(v) => patch('name', v)}
                placeholder="e.g. Diwali dine-in → online push"
              />
              <Field
                label="Code prefix"
                required
                value={draft.codePrefix}
                onChange={(v) => patch('codePrefix', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
                placeholder="EATIN"
                help={
                  isNew
                    ? 'Uppercase alphanumeric, 2–16 chars. We append a 4-digit suffix for percentage codes (e.g. EATIN20 → EATIN2042).'
                    : 'Code prefix is immutable after creation.'
                }
                disabled={!isNew}
              />
            </div>
            <div>
              <Label>Customer-facing description</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={draft.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="What the customer reads on the receipt / email"
              />
            </div>
          </Section>

          {/* 2. Channel */}
          <Section title="Channel">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ChannelCard
                selected={draft.channel === 'DINE_IN_TO_ONLINE'}
                onClick={() => isNew && patch('channel', 'DINE_IN_TO_ONLINE')}
                disabled={!isNew}
                emoji="🍽️→📱"
                title="Dine-in → Online"
                description="Printed on receipts. Customer types it at online checkout next time."
                fromIcon={Utensils}
                toIcon={Smartphone}
              />
              <ChannelCard
                selected={draft.channel === 'ONLINE_TO_DINE_IN'}
                onClick={() => isNew && patch('channel', 'ONLINE_TO_DINE_IN')}
                disabled={!isNew}
                emoji="📱→🍽️"
                title="Online → Dine-in"
                description="Emailed after delivery. Customer scans the QR in-restaurant."
                fromIcon={Smartphone}
                toIcon={Utensils}
              />
            </div>
            {!isNew && (
              <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Info className="size-3.5 mt-0.5 shrink-0" />
                <span>Channel is immutable after creation — it controls how the cart engine validates the code.</span>
              </div>
            )}
          </Section>

          {/* 3. Discount */}
          <Section title="Discount">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <DiscountTypeCard
                selected={draft.discountType === 'PERCENTAGE'}
                onClick={() => isNew && patch('discountType', 'PERCENTAGE')}
                disabled={!isNew}
                icon={Percent}
                title="Percentage"
                description="X% off the cart, optionally capped."
              />
              <DiscountTypeCard
                selected={draft.discountType === 'FIXED'}
                onClick={() => isNew && patch('discountType', 'FIXED')}
                disabled={!isNew}
                icon={IndianRupee}
                title="Flat ₹ off"
                description="Subtract a fixed rupee amount from the cart."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field
                label={draft.discountType === 'PERCENTAGE' ? 'Percent off (%)' : 'Flat off (₹)'}
                type="number"
                value={String(draft.discountValue)}
                onChange={(v) => patch('discountValue', Math.max(0, Number(v) || 0))}
                required
                disabled={!isNew}
              />
              {draft.discountType === 'PERCENTAGE' && (
                <Field
                  label="Max discount (₹)"
                  type="number"
                  value={String(draft.maxDiscount)}
                  onChange={(v) => patch('maxDiscount', Math.max(0, Number(v) || 0))}
                  help="0 = uncapped"
                  disabled={!isNew}
                />
              )}
            </div>
          </Section>

          {/* 4. Eligibility */}
          <Section title="Eligibility">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field
                label="Min order (₹)"
                type="number"
                value={String(draft.minOrderAmount)}
                onChange={(v) => patch('minOrderAmount', Math.max(0, Number(v) || 0))}
                disabled={!isNew}
              />
              <Field
                label="Per-user limit"
                type="number"
                value={String(draft.perUserLimit)}
                onChange={(v) => patch('perUserLimit', Math.max(1, Number(v) || 1))}
                disabled={!isNew}
              />
              <Field
                label="Total uses"
                type="number"
                value={String(draft.maxUses)}
                onChange={(v) => patch('maxUses', Math.max(0, Number(v) || 0))}
                help="0 = unlimited"
                disabled={!isNew}
              />
            </div>
          </Section>

          {/* 5. Validity */}
          <Section title="Validity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Valid from"
                type="datetime-local"
                value={draft.validFrom}
                onChange={(v) => patch('validFrom', v)}
                disabled={!isNew}
              />
              <Field
                label="Expires at"
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(v) => patch('expiresAt', v)}
                help="Leave blank for no end"
                disabled={!isNew}
              />
            </div>
          </Section>

          {/* 6. Distribution */}
          <Section title="Distribution tracking">
            <Field
              label="How many receipts / emails will you print or send?"
              type="number"
              value={String(draft.distributedCount)}
              onChange={(v) => patch('distributedCount', Math.max(0, Number(v) || 0))}
              help="Used as the denominator for conversion rate. Update this after each print/email run."
            />
            {!isNew && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatusButton
                  active={draft.status === 'ACTIVE'}
                  onClick={() => patch('status', 'ACTIVE')}
                  label="Active"
                />
                <StatusButton
                  active={draft.status === 'PAUSED'}
                  onClick={() => patch('status', 'PAUSED')}
                  label="Paused"
                />
                <StatusButton
                  active={draft.status === 'DRAFT'}
                  onClick={() => patch('status', 'DRAFT')}
                  label="Draft"
                />
              </div>
            )}
          </Section>

          {/* 7. Live preview */}
          <Preview draft={draft} previewCode={previewCode} />
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t mt-4">
          <div>
            {!isNew && campaign?.status === 'ACTIVE' && (
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
              {busy ? 'Saving…' : isNew ? 'Create campaign' : 'Save changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Building blocks ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label, value, onChange, type = 'text', required = false, help, placeholder, disabled
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && (
        <Label>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      <Input
        className={label ? 'mt-1' : ''}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      {help && <div className="text-[11px] text-muted-foreground mt-1">{help}</div>}
    </div>
  );
}

function ChannelCard({
  selected, onClick, disabled, emoji, title, description, fromIcon: FromIcon, toIcon: ToIcon
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  emoji: string;
  title: string;
  description: string;
  fromIcon: any;
  toIcon: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-lg border p-4 transition-colors ${
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent'
      } ${disabled && !selected ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center gap-2">
        <FromIcon className="size-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">→</span>
        <ToIcon className="size-4 text-muted-foreground" />
        <Badge variant={selected ? 'default' : 'muted'} className="ml-auto text-[10px]">
          {emoji}
        </Badge>
      </div>
      <div className="mt-2 font-semibold text-sm">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

function DiscountTypeCard({
  selected, onClick, disabled, icon: Icon, title, description
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-lg border p-3 transition-colors ${
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent'
      } ${disabled && !selected ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{description}</div>
    </button>
  );
}

function StatusButton({
  active, onClick, label
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-muted-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function Preview({ draft, previewCode }: { draft: Draft; previewCode: string }) {
  const isDineToOnline = draft.channel === 'DINE_IN_TO_ONLINE';
  const headline = useMemo(() => {
    if (draft.discountValue <= 0) return 'Set a discount value to see the preview';
    if (draft.discountType === 'PERCENTAGE') {
      const cap = draft.maxDiscount > 0 ? ` (max ${money(draft.maxDiscount)})` : '';
      return `Save ${draft.discountValue}%${cap} on your next ${isDineToOnline ? 'online order' : 'visit'}`;
    }
    return `Save ${money(draft.discountValue)} on your next ${isDineToOnline ? 'online order' : 'visit'}`;
  }, [draft.discountType, draft.discountValue, draft.maxDiscount, isDineToOnline]);

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Mail className="size-4 text-primary" /> Live preview
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {isDineToOnline ? 'Printed at the bottom of dine-in receipts' : 'Emailed after the online order is delivered'}
      </div>
      <div className="mt-3 rounded-md border bg-background p-4 font-mono text-xs leading-relaxed">
        <div className="text-center font-semibold text-sm">
          {isDineToOnline ? '— Thanks for dining with us —' : '— Thanks for ordering online —'}
        </div>
        <div className="text-center mt-2 text-foreground">
          {headline}
        </div>
        <div className="text-center mt-1">
          Use code{' '}
          <span className="inline-block rounded border-2 border-dashed border-primary/60 px-2 py-0.5 font-bold text-base text-primary">
            {previewCode || 'CODE'}
          </span>
        </div>
        <div className="text-center mt-1 text-muted-foreground">
          {isDineToOnline
            ? 'at maverick.app — valid for one use per customer'
            : 'when you next visit — scan the QR on your email'}
        </div>
        {draft.minOrderAmount > 0 && (
          <div className="text-center mt-2 text-[10px] text-muted-foreground">
            Minimum order {money(draft.minOrderAmount)}.
          </div>
        )}
      </div>
    </div>
  );
}
