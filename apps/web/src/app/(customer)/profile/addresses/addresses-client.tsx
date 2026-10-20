'use client';
/**
 * Customer-side address manager. The server page renders the saved list and
 * passes it down; everything interactive (add / edit / delete / set default)
 * happens here via the `/api/customer/addresses` endpoints.
 *
 * The Leaflet picker is dynamically imported so SSR never sees it (Leaflet
 * touches `window` at import time).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import type { PickedAddress } from '@/components/address-picker';

const AddressPicker = dynamic(
  () => import('@/components/address-picker').then((m) => m.AddressPicker),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-[480px] w-full place-items-center rounded-xl border bg-muted/40 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
);

export interface AddressRow {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  landmark: string | null;
  floor: string | null;
  instructions: string | null;
  labelType: LabelType | null;
  labelName: string | null;
}

type LabelType = 'HOME' | 'WORK' | 'OTHER';
const LABEL_CHIPS: { value: LabelType; text: string }[] = [
  { value: 'HOME', text: 'Home' },
  { value: 'WORK', text: 'Work' },
  { value: 'OTHER', text: 'Other' }
];
const chipLabel = (a: AddressRow) =>
  a.labelType === 'OTHER' ? a.labelName || 'Other' : a.labelType ? LABEL_CHIPS.find((c) => c.value === a.labelType)!.text : a.label;

interface Props {
  addresses: AddressRow[];
}

export function AddressesClient({ addresses }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AddressRow | null>(null);
  const [picked, setPicked] = useState<PickedAddress | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [landmark, setLandmark] = useState('');
  const [floor, setFloor] = useState('');
  const [instructions, setInstructions] = useState('');
  const [labelType, setLabelType] = useState<LabelType>('HOME');
  const [labelName, setLabelName] = useState('');

  function loadDetails(a: AddressRow | null) {
    setLandmark(a?.landmark ?? '');
    setFloor(a?.floor ?? '');
    setInstructions(a?.instructions ?? '');
    setLabelType(a?.labelType ?? 'HOME');
    setLabelName(a?.labelName ?? '');
  }

  function startAdd() {
    setEditing(null);
    setPicked(null);
    loadDetails(null);
    setOpen(true);
  }

  function startEdit(a: AddressRow) {
    setEditing(a);
    setPicked(null);
    loadDetails(a);
    setOpen(true);
  }

  async function save() {
    if (!picked) return;
    if (!picked.line1.trim() || !picked.city.trim() || !picked.postalCode.trim()) {
      toast.error('Address line 1, city and PIN code are required');
      return;
    }
    if (labelType === 'OTHER' && !labelName.trim()) {
      toast.error('Give this address a name, e.g. "Mom\'s place"');
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `/api/customer/addresses/${editing.id}`
        : '/api/customer/addresses';
      const method = editing ? 'PATCH' : 'POST';
      const body = {
        ...picked,
        // Keep the legacy free-text label in step with the structured chip.
        label: labelType === 'OTHER' ? labelName.trim() : labelType === 'WORK' ? 'Work' : 'Home',
        landmark: landmark.trim(),
        floor: floor.trim(),
        instructions: instructions.trim(),
        labelType,
        labelName: labelType === 'OTHER' ? labelName.trim() : '',
        // First-ever address auto-becomes the default.
        isDefault: editing ? editing.isDefault : addresses.length === 0
      };
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        toast.error('Could not save address');
        return;
      }
      toast.success(editing ? 'Address updated' : 'Address saved');
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/customer/addresses/${id}/default`, { method: 'POST' });
      if (!r.ok) {
        toast.error('Could not set as default');
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: AddressRow) {
    if (!confirm(`Delete "${a.label}"?`)) return;
    setBusyId(a.id);
    try {
      const r = await fetch(`/api/customer/addresses/${a.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { message?: string } | null;
        toast.error(data?.message || 'Could not delete address');
        return;
      }
      toast.success('Address deleted');
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="display text-2xl font-semibold">Saved addresses</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startAdd} className="tap-press">
              <Plus className="size-4" /> Add address
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit address' : 'Add new address'}</DialogTitle>
            </DialogHeader>
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <AddressPicker
                initial={
                  editing
                    ? {
                        label: editing.label,
                        line1: editing.line1,
                        line2: editing.line2 || '',
                        city: editing.city,
                        state: editing.state || '',
                        postalCode: editing.postalCode,
                        country: editing.country,
                        latitude: editing.latitude,
                        longitude: editing.longitude
                      }
                    : undefined
                }
                onChange={setPicked}
              />
              <div className="mt-4 grid gap-3 rounded-xl border bg-muted/30 p-3 sm:p-4">
                <div>
                  <div className="mb-2 text-sm font-medium">Save as</div>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Address label">
                    {LABEL_CHIPS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={labelType === c.value}
                        onClick={() => setLabelType(c.value)}
                        className={`tap-press min-h-10 rounded-full border px-4 text-sm font-medium transition-colors ${
                          labelType === c.value
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'bg-background text-foreground hover:bg-muted'
                        }`}
                      >
                        {c.text}
                      </button>
                    ))}
                  </div>
                  {labelType === 'OTHER' && (
                    <Input
                      className="mt-2"
                      placeholder="Name this address (e.g. Mom's place)"
                      maxLength={40}
                      value={labelName}
                      onChange={(e) => setLabelName(e.target.value)}
                    />
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="addr-landmark">Landmark</Label>
                    <Input
                      id="addr-landmark"
                      placeholder="Near / opposite..."
                      maxLength={120}
                      value={landmark}
                      onChange={(e) => setLandmark(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="addr-floor">Floor / flat</Label>
                    <Input
                      id="addr-floor"
                      placeholder="e.g. 3rd floor, Flat 302"
                      maxLength={40}
                      value={floor}
                      onChange={(e) => setFloor(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="addr-instructions">Delivery instructions</Label>
                  <Textarea
                    id="addr-instructions"
                    rows={2}
                    placeholder="Gate code, call on arrival, leave with security..."
                    maxLength={300}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !picked} className="tap-press">
                {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save address'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {addresses.length === 0 ? (
        <Card className="card-lift">
          <CardContent className="grid place-items-center gap-2 py-12 text-center">
            <MapPin className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You haven't saved any delivery addresses yet.
            </p>
            <Button onClick={startAdd} className="tap-press mt-2">
              <Plus className="size-4" /> Add your first address
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {addresses.map((a) => (
            <Card key={a.id} className="card-lift">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{chipLabel(a)}</span>
                      {a.isDefault && <Badge variant="success">Default</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ''}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {a.city}
                      {a.state ? `, ${a.state}` : ''} {a.postalCode}
                    </div>
                    {(a.floor || a.landmark) && (
                      <div className="mt-1 text-sm text-muted-foreground">
                        {[a.floor, a.landmark].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {a.instructions && (
                      <div className="mt-1 text-xs italic text-muted-foreground">{a.instructions}</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!a.isDefault && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => makeDefault(a.id)}
                      disabled={busyId === a.id}
                      className="tap-press"
                    >
                      <Star className="size-4" /> Set default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(a)}
                    disabled={busyId === a.id}
                    className="tap-press"
                  >
                    <Pencil className="size-4" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(a)}
                    disabled={busyId === a.id}
                    className="tap-press text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
