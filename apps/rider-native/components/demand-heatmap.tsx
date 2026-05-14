/**
 * Demand heatmap — plots the live order-pool hotspots on a native map.
 *
 * Each demand point (a pickup branch with open orders) is drawn as a tinted
 * `Circle` whose radius and colour scale with intensity: HIGH = saffron/red,
 * MEDIUM = warning amber, LOW = muted grey. A small `Marker` sits at the centre
 * carrying the open-order count, and a legend overlay explains the colours.
 *
 * Uses react-native-maps (Google Maps on Android) — same import/setup as
 * components/delivery-map.tsx.
 */
import { useRef } from 'react';
import MapView, { Marker, Circle } from 'react-native-maps';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, font, shadow } from '../lib/theme';
import type { HeatmapPoint, DemandIntensity } from '../lib/api-dispatch';

export interface HeatmapRider {
  lat: number;
  lng: number;
}

/** Per-intensity visual treatment — fill colour, stroke, and circle radius (m). */
const INTENSITY_STYLE: Record<
  DemandIntensity,
  { color: string; fill: string; stroke: string; radiusM: number; label: string }
> = {
  HIGH: {
    color: colors.primary,
    fill: 'rgba(234, 91, 31, 0.28)',
    stroke: 'rgba(234, 91, 31, 0.9)',
    radiusM: 900,
    label: 'High demand',
  },
  MEDIUM: {
    color: colors.warning,
    fill: 'rgba(217, 138, 31, 0.24)',
    stroke: 'rgba(217, 138, 31, 0.85)',
    radiusM: 650,
    label: 'Medium demand',
  },
  LOW: {
    color: colors.textMuted,
    fill: 'rgba(122, 112, 96, 0.18)',
    stroke: 'rgba(122, 112, 96, 0.7)',
    radiusM: 420,
    label: 'Low demand',
  },
};

export function DemandHeatmap({
  points,
  rider,
}: {
  points: HeatmapPoint[];
  rider?: HeatmapRider | null;
}) {
  const mapRef = useRef<MapView>(null);

  // Nothing to plot — no open orders anywhere.
  if (points.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          No open orders on the map right now. Check back in a few minutes.
        </Text>
      </View>
    );
  }

  // Centre on the busiest hotspot (points arrive sorted busiest-first); fall
  // back to the rider's own location only if, somehow, the first point is bad.
  const anchor =
    points[0] && Number.isFinite(points[0].lat) && Number.isFinite(points[0].lng)
      ? { lat: points[0].lat, lng: points[0].lng }
      : rider ?? { lat: points[0].lat, lng: points[0].lng };

  const all = [...points.map((p) => ({ lat: p.lat, lng: p.lng })), ...(rider ? [rider] : [])];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);

  const initialRegion = {
    latitude: anchor.lat,
    longitude: anchor.lng,
    latitudeDelta: Math.max(latSpan * 1.8, 0.04),
    longitudeDelta: Math.max(lngSpan * 1.8, 0.04),
  };

  return (
    <View style={styles.wrap}>
      <MapView ref={mapRef} style={styles.map} initialRegion={initialRegion}>
        {points.map((p, i) => {
          const s = INTENSITY_STYLE[p.intensity];
          return (
            <View key={`${p.name}-${i}`}>
              <Circle
                center={{ latitude: p.lat, longitude: p.lng }}
                radius={s.radiusM}
                fillColor={s.fill}
                strokeColor={s.stroke}
                strokeWidth={2}
              />
              <Marker
                coordinate={{ latitude: p.lat, longitude: p.lng }}
                title={p.name}
                description={`${p.count} open order${p.count === 1 ? '' : 's'} · ${s.label}`}
                pinColor={s.color}
              />
            </View>
          );
        })}
        {rider ? (
          <Marker
            coordinate={{ latitude: rider.lat, longitude: rider.lng }}
            title="You"
            pinColor="#2563eb"
          />
        ) : null}
      </MapView>

      <View style={styles.legend}>
        {(['HIGH', 'MEDIUM', 'LOW'] as DemandIntensity[]).map((level) => (
          <View key={level} style={styles.legendRow}>
            <View
              style={[styles.legendDot, { backgroundColor: INTENSITY_STYLE[level].color }]}
            />
            <Text style={styles.legendText}>{INTENSITY_STYLE[level].label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { flex: 1 },
  legend: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    ...shadow.card,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: {
    fontSize: font.size.xs,
    color: colors.text,
    fontWeight: font.weight.medium,
  },
  placeholder: {
    flex: 1,
    minHeight: 180,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  placeholderText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
