'use client';
/**
 * Standalone "Change location" button (used by the empty state when no
 * restaurants are in range). Opens the shared LocationPickerDialog.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Navigation } from 'lucide-react';
import { LocationPickerDialog, type SavedAddressOption } from './location-picker-dialog';

interface Props {
  savedAddresses: SavedAddressOption[];
}

export function ChangeLocationButton({ savedAddresses }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="tap-press mt-4">
        <Navigation className="size-4" /> Change location
      </Button>
      <LocationPickerDialog open={open} onOpenChange={setOpen} savedAddresses={savedAddresses} />
    </>
  );
}
