'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function NewBranchForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({
    name: '', line1: '', city: '', state: '', postalCode: '',
    phone: '', email: '',
    taxRatePct: 5, baseDeliveryFee: 40, perKmDeliveryFee: 8,
    serviceRadiusKm: 7
  });
  return (
    <Card>
      <CardContent className="p-5">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await fetch('/api/admin/branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            setBusy(false);
            if (!r.ok) return toast.error('Failed: ' + (await r.text()));
            toast.success('Branch created');
            router.push('/admin/branches');
            router.refresh();
          }}
        >
          <Field label="Branch name" value={data.name} onChange={(v) => setData({ ...data, name: v })} placeholder="HSR Layout / Bandra West / etc" required />
          <Field label="Address line" value={data.line1} onChange={(v) => setData({ ...data, line1: v })} required />
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" value={data.city} onChange={(v) => setData({ ...data, city: v })} required />
            <Field label="State" value={data.state} onChange={(v) => setData({ ...data, state: v })} />
            <Field label="PIN" value={data.postalCode} onChange={(v) => setData({ ...data, postalCode: v })} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch phone" value={data.phone} onChange={(v) => setData({ ...data, phone: v })} />
            <Field label="Branch email" type="email" value={data.email} onChange={(v) => setData({ ...data, email: v })} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Tax %" type="number" value={String(data.taxRatePct)} onChange={(v) => setData({ ...data, taxRatePct: Number(v) })} />
            <Field label="Base fee" type="number" value={String(data.baseDeliveryFee)} onChange={(v) => setData({ ...data, baseDeliveryFee: Number(v) })} />
            <Field label="Per-km fee" type="number" value={String(data.perKmDeliveryFee)} onChange={(v) => setData({ ...data, perKmDeliveryFee: Number(v) })} />
            <Field label="Radius (km)" type="number" value={String(data.serviceRadiusKm)} onChange={(v) => setData({ ...data, serviceRadiusKm: Number(v) })} />
          </div>
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Creating…' : 'Create branch'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, type = 'text', ...rest }: { label: string; value: string; onChange: (v: string) => void; type?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" type={type} value={value} onChange={(e) => onChange(e.target.value)} {...(rest as any)} />
    </div>
  );
}
