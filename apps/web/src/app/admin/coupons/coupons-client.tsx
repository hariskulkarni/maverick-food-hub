'use client';
/**
 * Restaurant-admin coupons management surface.
 *
 *   <CouponsClient />
 *     – top toolbar with "New coupon" + the WELCOME50 quick-start when empty
 *     – a sortable table of all coupons for this restaurant
 *     – row click opens the same dialog used for create (in edit mode)
 *     – soft-delete via DELETE; isActive toggle via PATCH
 *
 * The auto-apply rule is currently persisted as a `description` prefix —
 * "[FIRST_ORDER] Welcome offer", "[AFTER:3] Loyalty bonus", "[BIRTHDAY] …" —
 * because the schema doesn't yet have a `meta` JSON column. Parsing helpers
 * below keep the UI honest about that.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Sparkles, Trash2, Tag, Percent, IndianRupee } from 'lucide-react';
import { money, fmtDate } from '@/lib/utils';
import { toast } from 'sonner';

type Coupon = {
  id: string;
  code: string;
  description: string | null;
  branchId: string | null;
  flatOff: string | number | null;
  percentOff: number | null;
  minOrderAmount: string | number | null;
  maxDiscount: string | number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
  createdAt: string;
};

type Branch = { id: string; name: string; isActive: boolean };

const RULES = [
  { key: 'NONE',        label: 'None',             prefix: ''               },
  { key: 'FIRST_ORDER', label: 'First order only', prefix: '[FIRST_ORDER]'  },
  { key: 'AFTER',       label: 'After N orders',   prefix: '[AFTER:N]'      },
  { key: 'BIRTHDAY',    label: 'On birthday',      prefix: '[BIRTHDAY]'     },
  { key: 'CUSTOM',      label: 'Custom',           prefix: '[CUSTOM]'       }
] as const;

export function CouponsClient({ coupons, branches }: { coupons: Coupon[]; branches: Branch[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<Coupon> | null>(null);
  const [creatingWelcome, setCreatingWelcome] = useState(false);

  const empty = coupons.length === 0;

  async function createWelcome() {
    setCreatingWelcome(true);
    try {
      const r = await fetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'WELCOME50',
          description: '[FIRST_ORDER] Welcome offer — ₹50 off your first order',
          flatOff: 50,
          minOrderAmount: 250,
          perUserLimit: 1,
          usageLimit: 1000,
          isActive: true
        })
      });
      if (!r.ok) {
        toast.error('Failed: ' + (await r.text()));
        return;
      }
      toast.success('WELCOME50 created');
      router.refresh();
    } finally {
      setCreatingWelcome(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* First-order suggestion */}
      {empty && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary shrink-0">
              <Sparkles className="size-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">Get your first-order coupon live in one click</div>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono font-semibold">WELCOME50</span> gives every new customer ₹50 off their first order (min ₹250). Edit it any time after.
              </p>
            </div>
            <Button onClick={createWelcome} disabled={creatingWelcome}>
              <Sparkles className="size-4" />
              {creatingWelcome ? 'Creating…' : 'Create WELCOME50'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {coupons.length} {coupons.length === 1 ? 'coupon' : 'coupons'}
        </div>
        <Button onClick={() => setEditing({})}>
          <Plus className="size-4" /> New coupon
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>Code</Th>
                  <Th>Type</Th>
                  <Th align="right">Min order</Th>
                  <Th>Limits</Th>
                  <Th>Validity</Th>
                  <Th align="right">Usage</Th>
                  <Th align="center">Active</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {coupons.length === 0 && (
                  <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">No coupons yet.</td></tr>
                )}
                {coupons.map((c) => {
                  const expired = c.validTo && new Date(c.validTo).getTime() < Date.now();
                  const dim = expired || !c.isActive;
                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-muted/30 cursor-pointer ${dim ? 'opacity-55' : ''}`}
                      onClick={() => setEditing(c)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Tag className="size-3.5 text-muted-foreground" />
                          <span className="font-mono font-semibold">{c.code}</span>
                          {expired && <Badge variant="muted" className="text-[10px]">Expired</Badge>}
                        </div>
                        {c.description && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[280px]">{cleanDescription(c.description)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.flatOff ? (
                          <span className="inline-flex items-center gap-1"><IndianRupee className="size-3" />{Number(c.flatOff).toFixed(0)} off</span>
                        ) : c.percentOff ? (
                          <span className="inline-flex items-center gap-1"><Percent className="size-3" />{c.percentOff}{c.maxDiscount ? ` (max ${money(Number(c.maxDiscount))})` : ''}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.minOrderAmount ? money(Number(c.minOrderAmount)) : '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.perUserLimit}/user · {c.usageLimit ?? '∞'} total
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(c.validFrom, { dateStyle: 'medium' })}
                        {c.validTo ? <> → {fmtDate(c.validTo, { dateStyle: 'medium' })}</> : ' → no end'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.usedCount}/{c.usageLimit ?? '∞'}
                      </td>
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <ToggleActive id={c.id} initial={c.isActive} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <CouponDialog
          coupon={editing}
          branches={branches}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── dialog ────────────────────────────────────────────────────────────────
function CouponDialog({
  coupon, branches, onClose
}: {
  coupon: Partial<Coupon>;
  branches: Branch[];
  onClose: () => void;
}) {
  const router = useRouter();
  const isNew = !coupon.id;
  const initialRule = detectRule(coupon.description ?? '');

  const [form, setForm] = useState({
    code: coupon.code ?? '',
    description: cleanDescription(coupon.description ?? ''),
    branchId: coupon.branchId ?? branches[0]?.id ?? '',
    kind: (coupon.percentOff ? 'PERCENT' : 'FLAT') as 'FLAT' | 'PERCENT',
    flatOff: coupon.flatOff != null ? Number(coupon.flatOff) : 50,
    percentOff: coupon.percentOff ?? 10,
    maxDiscount: coupon.maxDiscount != null ? Number(coupon.maxDiscount) : 0,
    minOrderAmount: coupon.minOrderAmount != null ? Number(coupon.minOrderAmount) : 0,
    perUserLimit: coupon.perUserLimit ?? 1,
    usageLimit: coupon.usageLimit ?? 1000,
    validFrom: toInputDate(coupon.validFrom),
    validTo: toInputDate(coupon.validTo),
    isActive: coupon.isActive ?? true,
    rule: initialRule.key,
    ruleN: initialRule.n
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.code.trim()) return toast.error('Code is required');
    setBusy(true);
    try {
      const rulePrefix = buildRulePrefix(form.rule, form.ruleN);
      const fullDescription = [rulePrefix, form.description.trim()].filter(Boolean).join(' ').trim() || null;
      const body: any = {
        code: form.code.trim().toUpperCase(),
        description: fullDescription,
        branchId: form.branchId || null,
        flatOff: form.kind === 'FLAT' ? form.flatOff : null,
        percentOff: form.kind === 'PERCENT' ? form.percentOff : null,
        maxDiscount: form.kind === 'PERCENT' && form.maxDiscount > 0 ? form.maxDiscount : null,
        minOrderAmount: form.minOrderAmount > 0 ? form.minOrderAmount : null,
        perUserLimit: form.perUserLimit,
        usageLimit: form.usageLimit,
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
        validTo: form.validTo ? new Date(form.validTo).toISOString() : null,
        isActive: form.isActive
      };
      const url = isNew ? '/api/admin/coupons' : `/api/admin/coupons/${coupon.id}`;
      const r = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) { toast.error('Failed: ' + (await r.text())); return; }
      toast.success(isNew ? 'Coupon created' : 'Coupon saved');
      onClose();
      router.refresh();
    } finally { setBusy(false); }
  }

  async function softDelete() {
    if (!coupon.id) return;
    if (!confirm('Deactivate this coupon? Existing redemptions stay intact.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/coupons/${coupon.id}`, { method: 'DELETE' });
      if (!r.ok) { toast.error('Failed: ' + (await r.text())); return; }
      toast.success('Coupon deactivated');
      onClose();
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isNew ? 'New coupon' : `Edit ${coupon.code}`}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" required value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} />
            <div>
              <Label>Branch</Label>
              <Select value={form.branchId} onValueChange={(v) => setForm({ ...form, branchId: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}{!b.isActive && ' (inactive)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Input className="mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What customers see (e.g. 'Welcome offer — ₹50 off')" />
          </div>

          {/* Type chooser */}
          <div>
            <Label>Discount type</Label>
            <div className="mt-1 flex gap-2">
              <KindChip active={form.kind === 'FLAT'}    onClick={() => setForm({ ...form, kind: 'FLAT' })}>Flat amount</KindChip>
              <KindChip active={form.kind === 'PERCENT'} onClick={() => setForm({ ...form, kind: 'PERCENT' })}>Percentage</KindChip>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {form.kind === 'FLAT' ? (
                <Field label="Flat off (₹)" type="number" value={String(form.flatOff)} onChange={(v) => setForm({ ...form, flatOff: Number(v) })} />
              ) : (
                <>
                  <Field label="Percent off (%)" type="number" value={String(form.percentOff)} onChange={(v) => setForm({ ...form, percentOff: Number(v) })} />
                  <Field label="Cap (max ₹ off)" type="number" value={String(form.maxDiscount)} onChange={(v) => setForm({ ...form, maxDiscount: Number(v) })} />
                </>
              )}
              <Field label="Min order (₹)" type="number" value={String(form.minOrderAmount)} onChange={(v) => setForm({ ...form, minOrderAmount: Number(v) })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Per-user limit" type="number" value={String(form.perUserLimit)} onChange={(v) => setForm({ ...form, perUserLimit: Math.max(1, Number(v) || 1) })} />
            <Field label="Total usage limit" type="number" value={String(form.usageLimit)} onChange={(v) => setForm({ ...form, usageLimit: Math.max(1, Number(v) || 1) })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from" type="date" value={form.validFrom} onChange={(v) => setForm({ ...form, validFrom: v })} />
            <Field label="Valid until" type="date" value={form.validTo} onChange={(v) => setForm({ ...form, validTo: v })} />
          </div>

          {/* Auto-apply rule chips */}
          <div>
            <Label>Auto-apply rule</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {RULES.map((r) => (
                <KindChip key={r.key} active={form.rule === r.key} onClick={() => setForm({ ...form, rule: r.key })}>
                  {r.label}
                </KindChip>
              ))}
            </div>
            {form.rule === 'AFTER' && (
              <div className="mt-2">
                <Field
                  label="N (orders)"
                  type="number"
                  value={String(form.ruleN)}
                  onChange={(v) => setForm({ ...form, ruleN: Math.max(1, Number(v) || 1) })}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-md border p-3">
            <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: !!v })} />
            <div>
              <div className="text-sm font-medium">{form.isActive ? 'Active' : 'Disabled'}</div>
              <div className="text-xs text-muted-foreground">Inactive coupons aren't applied at checkout.</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <div>
            {!isNew && (
              <Button variant="outline" onClick={softDelete} disabled={busy} className="text-destructive border-destructive/30 hover:bg-destructive/10">
                <Trash2 className="size-4" /> Deactivate
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : (isNew ? 'Create coupon' : 'Save changes')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── small bits ─────────────────────────────────────────────────────────────
function ToggleActive({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  return (
    <Switch
      checked={v}
      onCheckedChange={async (next) => {
        setV(!!next);
        const r = await fetch(`/api/admin/coupons/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !!next })
        });
        if (!r.ok) {
          setV(!next);
          toast.error('Failed to update');
          return;
        }
        router.refresh();
      }}
    />
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return <th className={`${alignCls} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Field({
  label, value, onChange, type = 'text', required = false
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <Label>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <Input className="mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function KindChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}
    >
      {children}
    </button>
  );
}

// ─── helpers for rule prefix encoding ───────────────────────────────────────
function detectRule(desc: string): { key: typeof RULES[number]['key']; n: number } {
  const m = desc.match(/^\[(FIRST_ORDER|BIRTHDAY|CUSTOM)\]/);
  if (m) return { key: m[1] as any, n: 1 };
  const after = desc.match(/^\[AFTER:(\d+)\]/);
  if (after) return { key: 'AFTER', n: Number(after[1]) || 1 };
  return { key: 'NONE', n: 1 };
}

function cleanDescription(desc: string): string {
  return desc.replace(/^\[(FIRST_ORDER|BIRTHDAY|CUSTOM|AFTER:\d+)\]\s*/, '');
}

function buildRulePrefix(rule: string, n: number): string {
  switch (rule) {
    case 'FIRST_ORDER': return '[FIRST_ORDER]';
    case 'BIRTHDAY':    return '[BIRTHDAY]';
    case 'CUSTOM':      return '[CUSTOM]';
    case 'AFTER':       return `[AFTER:${Math.max(1, n)}]`;
    default:            return '';
  }
}

function toInputDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  // YYYY-MM-DD for <input type="date">
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
