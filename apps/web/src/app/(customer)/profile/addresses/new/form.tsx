'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export function NewAddressForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({
    label: 'Home',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    isDefault: true
  });

  return (
    <Card>
      <CardContent className="p-5">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await fetch('/api/addresses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            setBusy(false);
            if (!r.ok) return toast.error('Failed to save');
            toast.success('Address saved');
            router.push('/profile/addresses');
          }}
        >
          <Field label="Label" value={data.label} onChange={(v) => setData({ ...data, label: v })} placeholder="Home / Office / Mom" />
          <Field label="Line 1" value={data.line1} onChange={(v) => setData({ ...data, line1: v })} required />
          <Field label="Line 2" value={data.line2} onChange={(v) => setData({ ...data, line2: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" value={data.city} onChange={(v) => setData({ ...data, city: v })} required />
            <Field label="State" value={data.state} onChange={(v) => setData({ ...data, state: v })} />
          </div>
          <Field label="PIN code" value={data.postalCode} onChange={(v) => setData({ ...data, postalCode: v })} required />
          <label className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">Set as default</span>
            <Switch checked={data.isDefault} onCheckedChange={(v) => setData({ ...data, isDefault: !!v })} />
          </label>
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save address'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}
