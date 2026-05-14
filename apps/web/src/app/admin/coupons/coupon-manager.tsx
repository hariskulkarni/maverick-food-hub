'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { money } from '@/lib/utils';
import { toast } from 'sonner';

export function CouponManager({ coupons }: { coupons: any[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ code: '', flatOff: 0, percentOff: 0, minOrderAmount: 0, maxDiscount: 0, usageLimit: 1000, perUserLimit: 1, isActive: true });
  return (
    <div className="grid gap-6 md:grid-cols-[360px_1fr]">
      <Card>
        <CardContent className="p-5 space-y-3">
          <h3 className="font-semibold">New coupon</h3>
          <Field label="Code" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Flat off" type="number" value={String(form.flatOff)} onChange={(v) => setForm({ ...form, flatOff: Number(v) })} />
            <Field label="% off" type="number" value={String(form.percentOff)} onChange={(v) => setForm({ ...form, percentOff: Number(v) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min order" type="number" value={String(form.minOrderAmount)} onChange={(v) => setForm({ ...form, minOrderAmount: Number(v) })} />
            <Field label="Max discount" type="number" value={String(form.maxDiscount)} onChange={(v) => setForm({ ...form, maxDiscount: Number(v) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total uses" type="number" value={String(form.usageLimit)} onChange={(v) => setForm({ ...form, usageLimit: Number(v) })} />
            <Field label="Per user" type="number" value={String(form.perUserLimit)} onChange={(v) => setForm({ ...form, perUserLimit: Number(v) })} />
          </div>
          <Button
            className="w-full"
            onClick={async () => {
              const body = { ...form, flatOff: form.flatOff || null, percentOff: form.percentOff || null, minOrderAmount: form.minOrderAmount || null, maxDiscount: form.maxDiscount || null };
              const r = await fetch('/api/admin/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
              if (!r.ok) return toast.error('Failed');
              toast.success('Created');
              setForm({ ...form, code: '' });
              router.refresh();
            }}
          >Create</Button>
        </CardContent>
      </Card>

      <div className="grid gap-2">
        {coupons.map((c) => (
          <Card key={c.id}><CardContent className="p-4 flex items-center gap-3">
            <div className="font-mono text-base font-semibold">{c.code}</div>
            <div className="flex-1 text-sm text-muted-foreground">
              {c.flatOff ? `${money(Number(c.flatOff))} off` : c.percentOff ? `${c.percentOff}% off` : '—'}
              {c.minOrderAmount && <> · min {money(Number(c.minOrderAmount))}</>}
              {' · '}{c.usedCount}/{c.usageLimit ?? '∞'}
            </div>
            <ToggleActive id={c.id} initial={c.isActive} />
          </CardContent></Card>
        ))}
        {coupons.length === 0 && <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center text-muted-foreground">No coupons yet.</div>}
      </div>
    </div>
  );
}

function ToggleActive({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  return <Switch checked={v} onCheckedChange={async (next) => { setV(!!next); await fetch(`/api/admin/coupons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !!next }) }); router.refresh(); }} />;
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <div><Label>{label}</Label><Input className="mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}
