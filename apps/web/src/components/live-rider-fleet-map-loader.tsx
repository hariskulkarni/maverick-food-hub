'use client';
/**
 * SSR-safe loader for `<LiveRiderFleetMap>`. Leaflet touches `window` at
 * module-load time, so importing it from a Server Component (or even from a
 * Client Component during SSR pre-render) crashes with "window is not defined".
 *
 * Wrap with `next/dynamic({ ssr: false })` so the fleet map only ever loads
 * in the browser. Mirrors the pattern we use for the customer delivery map
 * (`src/app/(customer)/orders/[id]/delivery-map.tsx`) and the rider map
 * (`src/app/rider/rider-map.tsx`).
 *
 * Re-exports the types so consumers can `import { LiveRiderFleetMap, type RiderPosition }`
 * from this loader file instead of the underlying module.
 */
import dynamic from 'next/dynamic';
export type {
  RiderPosition,
  BranchPin,
  CustomerPin,
  StatusFilter,
  VisibleLayers
} from './live-rider-fleet-map';

export const LiveRiderFleetMap = dynamic(
  () => import('./live-rider-fleet-map').then((m) => m.LiveRiderFleetMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid place-items-center h-full min-h-[420px] rounded-xl border bg-muted/30 text-sm text-muted-foreground">
        Loading map…
      </div>
    )
  }
);
