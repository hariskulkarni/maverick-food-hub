'use client';
import dynamic from 'next/dynamic';

// Leaflet uses `window` at import — load only on the client.
const DeliveryMapInner = dynamic(() => import('./delivery-map-inner'), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full rounded-xl border bg-muted/40 grid place-items-center text-sm text-muted-foreground">
      Loading map…
    </div>
  )
});

export default DeliveryMapInner;
