/**
 * Native map for the active delivery — pickup pin, drop-off pin, and the
 * rider's live position. Uses react-native-maps (Google Maps on Android).
 *
 * `initialRegion` is computed once at mount from pickup + drop, so the map
 * frames the route on first paint; the rider marker then moves within it
 * without yanking the viewport around.
 */
import { useRef } from 'react';
import MapView, { Marker } from 'react-native-maps';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, font, shadow } from '../lib/theme';

export interface MapPoint {
  lat: number;
  lng: number;
}

export function DeliveryMap({
  pickup,
  drop,
  rider,
}: {
  pickup: MapPoint | null;
  drop: MapPoint | null;
  rider: MapPoint | null;
}) {
  const mapRef = useRef<MapView>(null);
  const fixed = [pickup, drop].filter((p): p is MapPoint => p != null);

  // Nothing to anchor the map on — the order has no geocoded coordinates.
  if (fixed.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          No map for this order — pickup/drop coordinates aren't set.
        </Text>
      </View>
    );
  }

  const all = [...fixed, ...(rider ? [rider] : [])];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const initialRegion = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.8, 0.015),
    longitudeDelta: Math.max((maxLng - minLng) * 1.8, 0.015),
  };

  // Re-frame the viewport on the rider's current position.
  function recenterOnRider() {
    if (!rider) return;
    mapRef.current?.animateToRegion(
      {
        latitude: rider.lat,
        longitude: rider.lng,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      },
      350
    );
  }

  return (
    <View style={styles.wrap}>
      <MapView ref={mapRef} style={styles.map} initialRegion={initialRegion}>
        {pickup ? (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title="Pickup"
            pinColor={colors.primary}
          />
        ) : null}
        {drop ? (
          <Marker
            coordinate={{ latitude: drop.lat, longitude: drop.lng }}
            title="Drop-off"
            pinColor={colors.success}
          />
        ) : null}
        {rider ? (
          <Marker
            coordinate={{ latitude: rider.lat, longitude: rider.lng }}
            title="You"
            pinColor="#2563eb"
          />
        ) : null}
      </MapView>
      {rider ? (
        <Pressable
          style={({ pressed }) => [
            styles.recenterBtn,
            pressed && styles.recenterBtnPressed,
          ]}
          onPress={recenterOnRider}
          hitSlop={8}
          accessibilityLabel="Recenter map on my location"
        >
          <Ionicons name="locate" size={20} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 200,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  map: { flex: 1 },
  recenterBtn: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  recenterBtnPressed: { backgroundColor: colors.primarySoft },
  placeholder: {
    minHeight: 90,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  placeholderText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
