'use client';
/**
 * Zone map editor — vanilla Leaflet + Leaflet.draw (handlers driven from our own
 * 44px buttons rather than the stock ~30px draw toolbar, for touch targets).
 *
 *  - POLYGON: draw a polygon; vertices are editable by dragging. Emits [lng,lat][].
 *  - CIRCLE:  draw a circle (centre + drag radius); editable. Emits centre + radiusKm.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { Button } from '@/components/ui/button';
import { Eraser, Hexagon, Circle as CircleIcon } from 'lucide-react';

export type LngLat = [number, number];
export interface CircleValue { lat: number; lng: number; radiusKm: number }

interface Props {
  mode: 'POLYGON' | 'CIRCLE';
  polygon: LngLat[] | null;
  circle: CircleValue | null;
  branchPoint: { lat: number; lng: number } | null;
  onPolygon: (ring: LngLat[] | null) => void;
  onCircle: (c: CircleValue | null) => void;
}

const FALLBACK = { lat: 16.3067, lng: 80.4365 };

export function ZoneMapEditor({ mode, polygon, circle, branchPoint, onPolygon, onCircle }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.FeatureGroup | null>(null);
  const cbRef = useRef({ onPolygon, onCircle });
  cbRef.current = { onPolygon, onCircle };
  const drawRef = useRef<{ start: () => void; clear: () => void }>({ start: () => {}, clear: () => {} });

  useEffect(() => {
    let disposed = false;
    let map: L.Map | null = null;
    (async () => {
      // leaflet-draw patches the global `L`; with ESM leaflet that global must be set first.
      (window as unknown as { L: typeof L }).L = L;
      await import('leaflet-draw');
      if (disposed || !elRef.current) return;

      const start = polygon?.[0]
        ? { lat: polygon[0][1], lng: polygon[0][0] }
        : circle
          ? { lat: circle.lat, lng: circle.lng }
          : branchPoint ?? FALLBACK;
      map = L.map(elRef.current, { center: [start.lat, start.lng], zoom: 13, scrollWheelZoom: true });
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      if (branchPoint) {
        L.circleMarker([branchPoint.lat, branchPoint.lng], {
          radius: 7, color: '#fff', weight: 2, fillColor: '#f97316', fillOpacity: 1,
        }).bindTooltip('Branch').addTo(map);
      }

      const group = new L.FeatureGroup().addTo(map);
      groupRef.current = group;
      const style = { color: '#f97316', weight: 3, fillOpacity: 0.18 };

      const emit = (layer: L.Layer) => {
        if (layer instanceof L.Circle) {
          const ll = layer.getLatLng();
          cbRef.current.onCircle({ lat: ll.lat, lng: ll.lng, radiusKm: layer.getRadius() / 1000 });
        } else if (layer instanceof L.Polygon) {
          const ring = (layer.getLatLngs()[0] as L.LatLng[]).map((p): LngLat => [p.lng, p.lat]);
          cbRef.current.onPolygon(ring);
        }
      };
      const adopt = (layer: L.Layer & { editing?: { enable: () => void } }) => {
        group.addLayer(layer);
        layer.editing?.enable();
        layer.on('edit', () => emit(layer));
      };

      if (mode === 'POLYGON' && polygon && polygon.length >= 3) {
        const poly = L.polygon(polygon.map(([lng, lat]) => [lat, lng] as [number, number]), style);
        adopt(poly);
        map.fitBounds(poly.getBounds(), { padding: [24, 24] });
      } else if (mode === 'CIRCLE' && circle) {
        const c = L.circle([circle.lat, circle.lng], { ...style, radius: circle.radiusKm * 1000 });
        adopt(c);
        map.fitBounds(c.getBounds(), { padding: [24, 24] });
      }

      map.on(L.Draw.Event.CREATED, (e) => {
        const layer = (e as L.DrawEvents.Created).layer;
        group.clearLayers();
        adopt(layer);
        emit(layer);
      });

      let handler: { disable: () => void } | null = null;
      drawRef.current = {
        start: () => {
          handler?.disable();
          group.clearLayers();
          cbRef.current.onPolygon(null);
          cbRef.current.onCircle(null);
          const h = mode === 'POLYGON'
            ? new L.Draw.Polygon(map as unknown as L.DrawMap, { allowIntersection: false, shapeOptions: style })
            : new L.Draw.Circle(map as unknown as L.DrawMap, { shapeOptions: style });
          handler = h;
          h.enable();
        },
        clear: () => {
          handler?.disable();
          group.clearLayers();
          cbRef.current.onPolygon(null);
          cbRef.current.onCircle(null);
        },
      };
    })();
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
    // The map is rebuilt only when the mode flips; shape edits flow out via callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-11 min-w-11" onClick={() => drawRef.current.start()}>
          {mode === 'POLYGON' ? <Hexagon className="size-4" /> : <CircleIcon className="size-4" />}
          {mode === 'POLYGON' ? 'Draw polygon' : 'Draw circle'}
        </Button>
        <Button type="button" variant="ghost" className="h-11 min-w-11" onClick={() => drawRef.current.clear()}>
          <Eraser className="size-4" /> Clear
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === 'POLYGON'
          ? 'Tap Draw polygon, click each corner, then click the first point to close. Drag the handles to adjust.'
          : 'Tap Draw circle, click the centre, then drag out to set the radius. Drag handles to adjust.'}
      </p>
      <div ref={elRef} className="h-[320px] w-full overflow-hidden rounded-lg border sm:h-[380px]" />
    </div>
  );
}
