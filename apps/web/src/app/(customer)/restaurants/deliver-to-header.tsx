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
}

export function DeliverToHeader({ label, savedAddresses }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <MapPin className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Deliver to
          </div>
          <div className="truncate text-sm font-medium">{label}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="tap-press shrink-0">
          Change
        </Button>
      </div>

      <LocationPickerDialog open={open} onOpenChange={setOpen} savedAddresses={savedAddresses} />
    </>
  );
}
