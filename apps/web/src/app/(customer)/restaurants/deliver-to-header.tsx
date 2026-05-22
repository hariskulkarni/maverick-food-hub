'use client';
/**
 * "Deliver to" header — shows the active delivery location label with a
 * "Change" affordance that reopens the same LocationPickerDialog used by the
 * gate. Rendered above the restaurant list when a location is set.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
import { LocationPickerDialog, type SavedAddressOption } from './location-picker-dialog';

interface Props {
  label: string;
  savedAddresses: SavedAddressOption[];
  /** Estimated delivery window shown above the address, e.g. "15–25 mins". */
  eta?: string;
}

export function DeliverToHeader({ label, savedAddresses, eta = '15–25 mins' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <MapPin className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">
            Delivery in {eta}
          </div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="tap-press shrink-0">
          Change
        </Button>
      </div>

      <LocationPickerDialog open={open} onOpenChange={setOpen} savedAddresses={savedAddresses} />
    </>
  );
}
