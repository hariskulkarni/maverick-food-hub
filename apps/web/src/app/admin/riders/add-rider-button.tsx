'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

export function AddRiderButton({ branches }: { branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({
    name: '',
    phone: '',
    branchId: branches[0]?.id ?? '',
    vehicleType: 'BIKE',
    vehicleNumber: ''
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="size-4" /> Add rider</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add rider directly</DialogTitle></DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await fetch('/api/admin/riders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
              setBusy(false);
              if (!r.ok) return toast.error('Failed: ' + (await r.text()));
              toast.success('Rider created');
              setOpen(false);
              router.refresh();
            }}
          >
            <div><Label>Name</Label><Input className="mt-1" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} required /></div>
            <div><Label>Phone</Label><Input className="mt-1" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} placeholder="+919876500099" required /></div>
            <div>
              <Label>Branch</Label>
              <Select value={data.branchId} onValueChange={(v) => setData({ ...data, branchId: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vehicle type</Label>
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
              <div><Label>Vehicle number</Label><Input className="mt-1" value={data.vehicleNumber} onChange={(e) => setData({ ...data, vehicleNumber: e.target.value })} /></div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create rider'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
