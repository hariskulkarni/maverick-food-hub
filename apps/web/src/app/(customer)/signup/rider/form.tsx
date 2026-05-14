'use client';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from 'sonner';

export function RiderSignupForm({ restaurants }: { restaurants: { id: string; name: string; cuisine: string | null }[] }) {
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState({
    restaurantId: restaurants[0]?.id ?? '',
    name: '',
    phone: '',
    vehicleType: 'BIKE',
    vehicleNumber: '',
    notes: ''
  });

  if (submitted)
    return (
      <Card><CardContent className="p-6 text-center">
        <h2 className="display text-2xl font-semibold">Application received.</h2>
        <p className="mt-2 text-muted-foreground">
          We've forwarded your details to the restaurant team. You'll get an SMS at <strong>{data.phone}</strong> when you're approved — sign in at
          <a href="/login" className="text-primary underline ml-1">/login</a> with that phone number.
        </p>
      </CardContent></Card>
    );

  return (
    <Card>
      <CardContent className="p-6">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await fetch('/api/signup/rider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
              if (!r.ok) throw new Error(await r.text());
              setSubmitted(true);
            } catch (e) { toast.error((e as Error).message); }
            finally { setBusy(false); }
          }}
        >
          <div>
            <Label>Restaurant you want to ride for</Label>
            <Select value={data.restaurantId} onValueChange={(v) => setData({ ...data, restaurantId: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {restaurants.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}{r.cuisine ? ` · ${r.cuisine}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
            {restaurants.length === 0 && <p className="mt-2 text-xs text-destructive">No active restaurants on the platform yet.</p>}
          </div>
          <Field label="Your name" value={data.name} onChange={(v) => setData({ ...data, name: v })} required />
          <Field label="Mobile number" value={data.phone} onChange={(v) => setData({ ...data, phone: v })} placeholder="+919876500099" required />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vehicle</Label>
              <Select value={data.vehicleType} onValueChange={(v) => setData({ ...data, vehicleType: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BIKE">Bike</SelectItem>
                  <SelectItem value="SCOOTER">Scooter</SelectItem>
                  <SelectItem value="BICYCLE">Bicycle</SelectItem>
                  <SelectItem value="CAR">Car</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field label="Vehicle number" value={data.vehicleNumber} onChange={(v) => setData({ ...data, vehicleNumber: v })} />
          </div>
          <div>
            <Label>Anything else (availability, zones)</Label>
            <Textarea className="mt-1" rows={3} value={data.notes} onChange={(e) => setData({ ...data, notes: e.target.value })} />
          </div>
          <Button type="submit" disabled={busy || restaurants.length === 0} className="w-full" size="lg">
            {busy ? 'Submitting…' : 'Apply'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} {...(rest as any)} />
    </div>
  );
}
