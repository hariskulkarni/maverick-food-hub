'use client';
/**
 * Location gate — shown when no delivery location is set yet (the cookie is
 * empty). No restaurant list is rendered until the customer picks a spot.
 * Opens the shared LocationPickerDialog, which offers current-location, map,
 * and saved-address options.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation } from 'lucide-react';
import { LocationPickerDialog, type SavedAddressOption } from './location-picker-dialog';

interface Props {
  savedAddresses: SavedAddressOption[];
}

export function LocationGate({ savedAddresses }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="container py-16 md:py-24">
      <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm reveal">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <MapPin className="size-7" />
        </div>
        <h1 className="display text-xl font-semibold md:text-2xl">Set your location to see restaurants</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ll only show restaurants that can deliver to you. Pick where you want your food.
        </p>
        <Button onClick={() => setOpen(true)} className="tap-press mt-6 w-full">
          <Navigation className="size-4" /> Set your location
        </Button>
        {savedAddresses.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Or choose from your {savedAddresses.length} saved{' '}
            {savedAddresses.length === 1 ? 'address' : 'addresses'}.
          </p>
        )}
      </div>

      <LocationPickerDialog open={open} onOpenChange={setOpen} savedAddresses={savedAddresses} />
    </div>
  );
}
