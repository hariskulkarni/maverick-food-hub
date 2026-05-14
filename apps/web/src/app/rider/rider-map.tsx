'use client';
import dynamic from 'next/dynamic';

// Leaflet uses `window` at import — load only on the client (also keeps the
// Capacitor WebView happy because Leaflet doesn't touch native APIs).
const RiderMapInner = dynamic(() => import('./rider-map-inner'), {
  ssr: false,
  loading: () => (
    <div className="h-60 w-full rounded-lg border bg-muted/40 grid place-items-center text-xs text-muted-foreground">
      Loading map…
    </div>
  )
});

export default RiderMapInner;
