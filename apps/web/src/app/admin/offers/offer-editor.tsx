'use client';
/**
 * Offer editor dialog — create / edit any of the 9 OfferType variants.
 *
 * Layout: a vertically-scrolled dialog (works on tablet width) with 4 sections:
 *   1. Identity     — name / description / code / priority / active / autoApply / stackable
 *   2. Type         — Select + per-type reward fields
 *   3. Scope        — branch, category multi-select, item multi-select (chip pickers)
 *   4. Eligibility  — minOrderAmount, usageLimit, perUserLimit, validFrom, validTo
 *
 * Live preview panel POSTs the current draft to /api/admin/offers/preview every
 * 400ms (debounced) against a canned cart and shows the resulting discount.
 *
 * Channel-locked variants (DINE_IN_TO_ONLINE / ONLINE_TO_DINE_IN) force the
 * issuedChannel and redeemChannel — the UI still shows them but greys them out.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Plus, X, Trash2, Sparkles, Search, Info } from 'lucide-react';
import { money } from '@/lib/utils';
import { toast } from 'sonner';
import {
  type Offer, type OfferType, type ChannelScope, type Branch, type Category, type MenuItem,
  OFFER_TYPE_META, OFFER_TYPE_ORDER
} from './offers-client';

// Forced channel locks for the channel-cross-pollination offer types.
const CHANNEL_LOCKS: Partial<Record<OfferType, { issued: ChannelScope; redeem: ChannelScope }>> = {
  DINE_IN_TO_ONLINE: { issued: 'DINE_IN', redeem: 'ONLINE' },
  ONLINE_TO_DINE_IN: { issued: 'ONLINE', redeem: 'DINE_IN' }
};

type Draft = {
  name: string;
  description: string;
  type: OfferType;
  code: string;
  priority: number;
  isActive: boolean;
  autoApply: boolean;
  stackable: boolean;
  // reward
  percentOff: number;
  flatOff: number;
  maxDiscount: number;
  rewardConfig: any;
  // scope
  branchId: string; // '' = all branches
  categoryIds: string[];
  itemIds: string[];
  // channels
  issuedChannel: ChannelScope;
  redeemChannel: ChannelScope;
  // eligibility
  minOrderAmount: number;
  usageLimit: number;
  perUserLimit: number;
  minCustomerOrders: number;
  validFrom: string;
  validTo: string;
};

function emptyDraft(seed: Partial<Offer> = {}): Draft {
  const type = (seed.type ?? 'PERCENTAGE') as OfferType;
  const lock = CHANNEL_LOCKS[type];
  return {
    name: seed.name ?? '',
    description: seed.description ?? '',
    type,
    code: seed.code ?? '',
    priority: seed.priority ?? 0,
    isActive: seed.isActive ?? true,
    autoApply: seed.autoApply ?? false,
    stackable: seed.stackable ?? false,
    percentOff: Number(seed.percentOff ?? 0),
    flatOff: Number(seed.flatOff ?? 0),
    maxDiscount: Number(seed.maxDiscount ?? 0),
    rewardConfig: seed.rewardConfig ?? {},
    branchId: seed.branchId ?? '',
    categoryIds: (seed.appliesToCategories ?? []).map((c) => c.categoryId),
    itemIds: (seed.appliesToItems ?? []).map((i) => i.menuItemId),
    issuedChannel: lock?.issued ?? (seed.issuedChannel ?? 'ANY'),
    redeemChannel: lock?.redeem ?? (seed.redeemChannel ?? 'ANY'),
    minOrderAmount: Number(seed.minOrderAmount ?? 0),
    usageLimit: seed.usageLimit ?? 0,
    perUserLimit: seed.perUserLimit ?? 1,
    minCustomerOrders: seed.minCustomerOrders ?? 0,
    validFrom: toLocalDateTime(seed.validFrom),
    validTo: toLocalDateTime(seed.validTo)
  };
}

export function OfferEditor({
  offer, branches, categories, menuItems, restaurantId, onClose
}: {
  offer: Partial<Offer>;
  branches: Branch[];
  categories: Category[];
  menuItems: MenuItem[];
  restaurantId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !offer.id;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(offer));
  const [busy, setBusy] = useState(false);

  // Apply channel locks whenever the type changes
  function setType(next: OfferType) {
    const lock = CHANNEL_LOCKS[next];
    setDraft((d) => ({
      ...d,
      type: next,
      issuedChannel: lock?.issued ?? 'ANY',
      redeemChannel: lock?.redeem ?? 'ANY'
    }));
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setBusy(true);
    try {
      const body = buildBody(draft, restaurantId);
      const url = isNew ? '/api/admin/offers' : `/api/admin/offers/${offer.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success(isNew ? 'Offer created' : 'Offer saved');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!offer.id) return;
    if (!confirm('Deactivate this offer? Existing redemptions stay intact.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/offers/${offer.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success('Offer deactivated');
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const meta = OFFER_TYPE_META[draft.type];
  const channelLocked = !!CHANNEL_LOCKS[draft.type];
  const scopedCategories = useMemo(() => {
    if (!draft.branchId) return categories;
    return categories.filter((c) => c.branchId === draft.branchId);
  }, [categories, draft.branchId]);
  const scopedItems = useMemo(() => {
    if (!draft.branchId) return menuItems;
    return menuItems.filter((i) => i.branchId === draft.branchId);
  }, [menuItems, draft.branchId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New offer' : `Edit ${offer.name}`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── 1. Identity ─────────────────────────────────────────── */}
          <Section title="Identity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Internal name" required value={draft.name} onChange={(v) => patch('name', v)} placeholder="e.g. Diwali weekend 20% off" />
              <Field
                label="Promo code"
                value={draft.code}
                onChange={(v) => patch('code', v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                placeholder="DIWALI20"
                help="Leave blank for auto-apply only"
              />
            </div>
            <div>
              <Label>Customer-facing description</Label>
              <Textarea
                className="mt-1"
                rows={2}
                value={draft.description}
                onChange={(e) => patch('description', e.target.value)}
                placeholder="What the customer sees in cart — e.g. 'Get 20% off, max ₹100'"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Priority (higher wins)" type="number" value={String(draft.priority)} onChange={(v) => patch('priority', Number(v) || 0)} />
              <div className="grid grid-cols-3 gap-2">
                <ToggleCard label="Active" hint="Eligible to apply" checked={draft.isActive} onChange={(v) => patch('isActive', v)} />
                <ToggleCard label="Auto-apply" hint="No code needed" checked={draft.autoApply} onChange={(v) => patch('autoApply', v)} />
                <ToggleCard label="Stackable" hint="Combines with others" checked={draft.stackable} onChange={(v) => patch('stackable', v)} />
              </div>
            </div>
          </Section>

          {/* ── 2. Type + reward ────────────────────────────────────── */}
          <Section title="Type & reward">
            <div>
              <Label>Offer type</Label>
              <Select value={draft.type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OFFER_TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>{OFFER_TYPE_META[t].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-1.5 text-xs text-muted-foreground flex items-start gap-1.5">
                <Info className="size-3.5 mt-0.5 shrink-0" />
                <span>{meta.hint}</span>
              </div>
            </div>

            <RewardFields draft={draft} patch={patch} scopedItems={scopedItems} />

            {channelLocked && (
              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs space-y-1">
                <div className="font-medium text-foreground">Channels are locked for this offer type</div>
                <div className="text-muted-foreground">Issued at <Badge variant="secondary" className="ml-1 mr-1">{draft.issuedChannel}</Badge> · Redeemable at <Badge variant="secondary" className="ml-1">{draft.redeemChannel}</Badge></div>
              </div>
            )}
            {!channelLocked && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Issued channel</Label>
                  <Select value={draft.issuedChannel} onValueChange={(v: any) => patch('issuedChannel', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANY">Any</SelectItem>
                      <SelectItem value="ONLINE">Online</SelectItem>
                      <SelectItem value="DINE_IN">Dine-in</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Redeemable on</Label>
                  <Select value={draft.redeemChannel} onValueChange={(v: any) => patch('redeemChannel', v)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANY">Any</SelectItem>
                      <SelectItem value="ONLINE">Online</SelectItem>
                      <SelectItem value="DINE_IN">Dine-in</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </Section>

          {/* ── 3. Scope ────────────────────────────────────────────── */}
          <Section title="Scope">
            <div>
              <Label>Branch</Label>
              <Select value={draft.branchId || '__all__'} onValueChange={(v) => {
                const next = v === '__all__' ? '' : v;
                // when narrowing to a branch, drop scope rows that don't belong
                setDraft((d) => ({
                  ...d,
                  branchId: next,
                  categoryIds: next ? d.categoryIds.filter((id) => categories.find((c) => c.id === id)?.branchId === next) : d.categoryIds,
                  itemIds: next ? d.itemIds.filter((id) => menuItems.find((m) => m.id === id)?.branchId === next) : d.itemIds
                }));
              }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}{!b.isActive && ' (inactive)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ChipPicker
              label="Categories"
              hint="Empty = applies to all categories"
              options={scopedCategories.map((c) => ({ id: c.id, label: c.name }))}
              selected={draft.categoryIds}
              onChange={(v) => patch('categoryIds', v)}
              placeholder="Search categories…"
            />
            <ChipPicker
              label="Items"
              hint="Empty = applies to all items in scope"
              options={scopedItems.map((i) => ({ id: i.id, label: i.name, sub: money(Number(i.price)) }))}
              selected={draft.itemIds}
              onChange={(v) => patch('itemIds', v)}
              placeholder="Search items…"
            />
          </Section>

          {/* ── 4. Eligibility ─────────────────────────────────────── */}
          <Section title="Eligibility">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Min order (₹)" type="number" value={String(draft.minOrderAmount)} onChange={(v) => patch('minOrderAmount', Number(v) || 0)} />
              <Field label="Total usage limit" type="number" value={String(draft.usageLimit)} onChange={(v) => patch('usageLimit', Math.max(0, Number(v) || 0))} help="0 = unlimited" />
              <Field label="Per-user limit" type="number" value={String(draft.perUserLimit)} onChange={(v) => patch('perUserLimit', Math.max(1, Number(v) || 1))} />
            </div>
            {draft.type === 'REPEAT_CUSTOMER' && (
              <Field
                label="Min completed orders"
                type="number"
                value={String(draft.minCustomerOrders)}
                onChange={(v) => patch('minCustomerOrders', Math.max(1, Number(v) || 1))}
                help="Customer needs at least this many prior completed orders"
              />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Valid from" type="datetime-local" value={draft.validFrom} onChange={(v) => patch('validFrom', v)} />
              <Field label="Valid until" type="datetime-local" value={draft.validTo} onChange={(v) => patch('validTo', v)} help="Leave blank for no end" />
            </div>
          </Section>

          {/* ── Preview ─────────────────────────────────────────────── */}
          <PreviewPanel draft={draft} restaurantId={restaurantId} branches={branches} />
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t mt-4">
          <div>
            {!isNew && offer.isActive && (
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
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : (isNew ? 'Create offer' : 'Save changes')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reward fields (per-type) ────────────────────────────────────────────────

function RewardFields({
  draft, patch, scopedItems
}: {
  draft: Draft;
  patch: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  scopedItems: MenuItem[];
}) {
  const setCfg = (key: string, value: any) => patch('rewardConfig', { ...(draft.rewardConfig ?? {}), [key]: value });

  switch (draft.type) {
    case 'PERCENTAGE':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Percent off (%)" type="number" value={String(draft.percentOff)} onChange={(v) => patch('percentOff', Math.min(100, Math.max(0, Number(v) || 0)))} required />
          <Field label="Max discount (₹)" type="number" value={String(draft.maxDiscount)} onChange={(v) => patch('maxDiscount', Number(v) || 0)} help="0 = uncapped" />
        </div>
      );
    case 'FIXED':
      return (
        <Field label="Flat off (₹)" type="number" value={String(draft.flatOff)} onChange={(v) => patch('flatOff', Number(v) || 0)} required />
      );
    case 'FIRST_ORDER':
    case 'REPEAT_CUSTOMER':
    case 'DINE_IN_TO_ONLINE':
    case 'ONLINE_TO_DINE_IN':
      return (
        <>
          <div className="text-xs text-muted-foreground">Provide either a flat amount or a percent (with optional cap) — the engine prefers whichever is set.</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Flat off (₹)" type="number" value={String(draft.flatOff)} onChange={(v) => patch('flatOff', Number(v) || 0)} />
            <Field label="Percent off (%)" type="number" value={String(draft.percentOff)} onChange={(v) => patch('percentOff', Math.min(100, Math.max(0, Number(v) || 0)))} />
            <Field label="Max discount (₹)" type="number" value={String(draft.maxDiscount)} onChange={(v) => patch('maxDiscount', Number(v) || 0)} />
          </div>
        </>
      );
    case 'BUY_X_GET_Y': {
      const cfg = draft.rewardConfig ?? {};
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ItemPicker
              label="Buy item"
              items={scopedItems}
              value={cfg.buyItemId ?? ''}
              onChange={(id) => setCfg('buyItemId', id)}
            />
            <Field label="Buy quantity" type="number" value={String(cfg.buyQty ?? 1)} onChange={(v) => setCfg('buyQty', Math.max(1, Number(v) || 1))} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ItemPicker
              label="Get item"
              items={scopedItems}
              value={cfg.getItemId ?? ''}
              onChange={(id) => setCfg('getItemId', id)}
            />
            <Field label="Get quantity" type="number" value={String(cfg.getQty ?? 1)} onChange={(v) => setCfg('getQty', Math.max(1, Number(v) || 1))} />
            <Field label="Discount on get (%)" type="number" value={String(cfg.getDiscountPct ?? 100)} onChange={(v) => setCfg('getDiscountPct', Math.min(100, Math.max(0, Number(v) || 0)))} help="100 = free" />
          </div>
        </div>
      );
    }
    case 'COMBO_DISCOUNT': {
      const items: { id: string; qty: number }[] = Array.isArray(draft.rewardConfig?.items) ? draft.rewardConfig.items : [];
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            {items.length === 0 && (
              <div className="text-xs text-muted-foreground italic">No combo items yet. Add at least 2 to define a bundle.</div>
            )}
            {items.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_100px_auto] gap-2 items-end">
                <ItemPicker
                  label={idx === 0 ? 'Item' : undefined}
                  items={scopedItems}
                  value={row.id}
                  onChange={(id) => {
                    const next = items.slice();
                    next[idx] = { ...next[idx], id };
                    setCfg('items', next);
                  }}
                />
                <Field
                  label={idx === 0 ? 'Qty' : undefined}
                  type="number"
                  value={String(row.qty)}
                  onChange={(v) => {
                    const next = items.slice();
                    next[idx] = { ...next[idx], qty: Math.max(1, Number(v) || 1) };
                    setCfg('items', next);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const next = items.slice();
                    next.splice(idx, 1);
                    setCfg('items', next);
                  }}
                  aria-label="Remove combo row"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setCfg('items', [...items, { id: '', qty: 1 }])}>
              <Plus className="size-4" /> Add item
            </Button>
          </div>
          <Field
            label="Combo price (₹)"
            type="number"
            value={String(draft.rewardConfig?.comboPrice ?? 0)}
            onChange={(v) => setCfg('comboPrice', Number(v) || 0)}
            help="The total customer pays for the bundle"
          />
        </div>
      );
    }
    case 'FREE_ITEM_ABOVE': {
      const cfg = draft.rewardConfig ?? {};
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ItemPicker
            label="Gift item"
            items={scopedItems}
            value={cfg.itemId ?? ''}
            onChange={(id) => setCfg('itemId', id)}
          />
          <Field
            label="Cart threshold (₹)"
            type="number"
            value={String(cfg.threshold ?? 0)}
            onChange={(v) => setCfg('threshold', Number(v) || 0)}
            required
          />
        </div>
      );
    }
    default:
      return null;
  }
}

// ─── Preview panel ───────────────────────────────────────────────────────────

function PreviewPanel({
  draft, restaurantId, branches
}: {
  draft: Draft;
  restaurantId: string;
  branches: Branch[];
}) {
  const [preview, setPreview] = useState<{ amountOff: number; reason?: string; loading: boolean }>({ amountOff: 0, loading: false });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runPreview(), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft)]);

  async function runPreview() {
    setPreview((p) => ({ ...p, loading: true }));
    try {
      // Canned cart: 3 items, ₹500 subtotal — adjusted to match the offer's
      // channel where possible so DINE_IN_TO_ONLINE doesn't always 0 out.
      const cannedCart = [
        { menuItemId: 'sample-1', categoryId: null, unitPrice: 200, quantity: 1, name: 'Sample item A' },
        { menuItemId: 'sample-2', categoryId: null, unitPrice: 150, quantity: 1, name: 'Sample item B' },
        { menuItemId: 'sample-3', categoryId: null, unitPrice: 150, quantity: 1, name: 'Sample item C' }
      ];
      const channel = draft.redeemChannel === 'DINE_IN' ? 'DINE_IN' : 'ONLINE';
      // The preview API expects `cart` as a flat array, with channel/branchId as
      // sibling fields (NOT nested under cart).
      const body = {
        draft: buildBody(draft, restaurantId),
        cart: cannedCart,
        channel,
        branchId: draft.branchId || branches[0]?.id || null,
        customerOrderCount: draft.type === 'FIRST_ORDER' ? 0 : 1
      };
      const r = await fetch('/api/admin/offers/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        setPreview({ amountOff: 0, reason: `Preview failed (${r.status})`, loading: false });
        return;
      }
      const j = await r.json();
      // Route returns { subtotal, result: { eligible, amountOff, reason } }.
      const res = j.result ?? {};
      setPreview({
        amountOff: Number(res.amountOff ?? 0),
        reason: res.reason ?? (res.eligible === false ? 'Not eligible for sample cart' : undefined),
        loading: false
      });
    } catch (e: any) {
      setPreview({ amountOff: 0, reason: e?.message ?? 'Preview error', loading: false });
    }
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" /> Live preview
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Sample cart: 3 items, subtotal {money(500)} on the {draft.redeemChannel === 'DINE_IN' ? 'dine-in' : 'online'} channel.
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          {preview.loading ? (
            <div className="text-xs text-muted-foreground animate-pulse">Calculating…</div>
          ) : preview.amountOff > 0 ? (
            <div className="text-sm">
              Would discount <span className="font-semibold text-primary">{money(preview.amountOff)}</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {preview.reason ?? 'Not eligible for this sample cart'}
            </div>
          )}
        </div>
        <Badge variant="muted" className="shrink-0 text-[10px]">Sample only</Badge>
      </div>
    </div>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
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

function ToggleCard({
  label, hint, checked, onChange
}: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-md border p-2 text-left text-xs transition-colors ${checked ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
    </button>
  );
}

function ChipPicker({
  label, hint, options, selected, onChange, placeholder
}: {
  label: string;
  hint?: string;
  options: { id: string; label: string; sub?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 30);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 30);
  }, [query, options]);

  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  return (
    <div>
      <Label>{label}</Label>
      {hint && <div className="text-[11px] text-muted-foreground mb-1">{hint}</div>}
      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const opt = options.find((o) => o.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-primary/10 text-primary px-2 py-0.5 text-xs">
                {opt?.label ?? id}
                <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${opt?.label ?? id}`}>
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative mt-2">
        <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8"
          placeholder={placeholder ?? 'Search…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md">
            {filtered.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  type="button"
                  key={o.id}
                  onMouseDown={(e) => { e.preventDefault(); toggle(o.id); }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent ${on ? 'bg-primary/5' : ''}`}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    {o.sub && <span className="tabular-nums">{o.sub}</span>}
                    {on && <Badge variant="success" className="text-[10px]">added</Badge>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemPicker({
  label, items, value, onChange
}: {
  label?: string;
  items: MenuItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <Select value={value || '__none__'} onValueChange={(v) => onChange(v === '__none__' ? '' : v)}>
        <SelectTrigger className={label ? 'mt-1' : ''}>
          <SelectValue placeholder="Pick item" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— pick item —</SelectItem>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>{i.name}{!i.isAvailable && ' (unavailable)'}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Body builder & date helpers ────────────────────────────────────────────

function buildBody(draft: Draft, restaurantId: string) {
  const lock = CHANNEL_LOCKS[draft.type];

  // Strip empty combo rows so the resolver doesn't trip over `{ id: '', qty: 1 }`.
  let rewardConfig: any = null;
  if (draft.type === 'BUY_X_GET_Y') {
    rewardConfig = {
      buyItemId: draft.rewardConfig?.buyItemId ?? '',
      buyQty: Number(draft.rewardConfig?.buyQty ?? 1),
      getItemId: draft.rewardConfig?.getItemId ?? '',
      getQty: Number(draft.rewardConfig?.getQty ?? 1),
      getDiscountPct: Number(draft.rewardConfig?.getDiscountPct ?? 100)
    };
  } else if (draft.type === 'COMBO_DISCOUNT') {
    const items = (Array.isArray(draft.rewardConfig?.items) ? draft.rewardConfig.items : [])
      .filter((r: any) => r && r.id);
    rewardConfig = { items, comboPrice: Number(draft.rewardConfig?.comboPrice ?? 0) };
  } else if (draft.type === 'FREE_ITEM_ABOVE') {
    rewardConfig = {
      itemId: draft.rewardConfig?.itemId ?? '',
      threshold: Number(draft.rewardConfig?.threshold ?? 0)
    };
  }

  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    type: draft.type,
    code: draft.code.trim() || null,
    percentOff: draft.percentOff > 0 ? draft.percentOff : null,
    flatOff: draft.flatOff > 0 ? draft.flatOff : null,
    maxDiscount: draft.maxDiscount > 0 ? draft.maxDiscount : null,
    minOrderAmount: draft.minOrderAmount > 0 ? draft.minOrderAmount : null,
    rewardConfig,
    restaurantId,
    branchId: draft.branchId || null,
    categoryIds: draft.categoryIds,
    itemIds: draft.itemIds,
    issuedChannel: lock?.issued ?? draft.issuedChannel,
    redeemChannel: lock?.redeem ?? draft.redeemChannel,
    minCustomerOrders: draft.type === 'REPEAT_CUSTOMER' ? Math.max(1, draft.minCustomerOrders) : 0,
    validFrom: draft.validFrom ? new Date(draft.validFrom).toISOString() : new Date().toISOString(),
    validTo: draft.validTo ? new Date(draft.validTo).toISOString() : null,
    usageLimit: draft.usageLimit > 0 ? draft.usageLimit : null,
    perUserLimit: Math.max(1, draft.perUserLimit),
    isActive: draft.isActive,
    priority: draft.priority,
    autoApply: draft.autoApply,
    stackable: draft.stackable
  };
}

function toLocalDateTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  // YYYY-MM-DDTHH:mm for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
