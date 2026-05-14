/**
 * Demand Map — "Where to go now".
 *
 * Shows the live order-pool hotspots on a native map plus a ranked list of
 * branches with open orders, so a rider can pre-position toward demand instead
 * of waiting cold. Pull-to-refresh; clean empty state when the pool is quiet.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { dispatch, type HeatmapPoint, type DemandIntensity } from '../lib/api-dispatch';
import { ApiError } from '../lib/api';
import { DemandHeatmap } from '../components/demand-heatmap';

/** Chip colour treatment for each intensity band. */
const INTENSITY_CHIP: Record<DemandIntensity, { bg: string; fg: string; label: string }> = {
  HIGH: { bg: colors.primarySoft, fg: colors.primary, label: 'High' },
  MEDIUM: { bg: '#fdf4e3', fg: colors.warning, label: 'Medium' },
  LOW: { bg: colors.bg, fg: colors.textMuted, label: 'Low' },
};

function IntensityChip({ intensity }: { intensity: DemandIntensity }) {
  const c = INTENSITY_CHIP[intensity];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

function HotspotRow({ point, rank }: { point: HeatmapPoint; rank: number }) {
  return (
    <View style={styles.hotspotRow}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>{rank}</Text>
      </View>
      <View style={styles.hotspotBody}>
        <Text style={styles.hotspotName} numberOfLines={1}>
          {point.name}
        </Text>
        <Text style={styles.hotspotMeta}>
          {point.count} open order{point.count === 1 ? '' : 's'}
        </Text>
      </View>
      <IntensityChip intensity={point.intensity} />
    </View>
  );
}

export default function HeatmapScreen() {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [totalOpen, setTotalOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await dispatch.heatmap();
      setPoints(res.points);
      setTotalOpen(res.totalOpen);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the demand map.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Demand Map</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <Text style={styles.headline}>Where to go now</Text>
          <Text style={styles.subhead}>
            {totalOpen > 0
              ? `${totalOpen} open order${totalOpen === 1 ? '' : 's'} across ${
                  points.length
                } hotspot${points.length === 1 ? '' : 's'}`
              : 'The order pool is quiet right now'}
          </Text>

          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          <View style={styles.mapWrap}>
            <DemandHeatmap points={points} />
          </View>

          {points.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="map-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No demand yet</Text>
              <Text style={styles.emptyBody}>
                Hotspots appear here the moment restaurants start marking orders
                ready. Pull down to refresh.
              </Text>
            </View>
          ) : (
            <View style={styles.listSection}>
              <Text style={styles.sectionTitle}>Ranked hotspots</Text>
              {points.map((p, i) => (
                <HotspotRow key={`${p.name}-${i}`} point={p} rank={i + 1} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },

  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  headline: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subhead: {
    marginTop: 2,
    fontSize: font.size.sm,
    color: colors.textMuted,
  },

  errorBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },

  mapWrap: {
    marginTop: spacing.md,
    height: 320,
  },

  listSection: { marginTop: spacing.lg, gap: spacing.sm },
  sectionTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },

  hotspotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadow.card,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.primary,
  },
  hotspotBody: { flex: 1 },
  hotspotName: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  hotspotMeta: {
    marginTop: 1,
    fontSize: font.size.sm,
    color: colors.textMuted,
  },

  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 0.3,
  },

  emptyCard: {
    marginTop: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    marginTop: spacing.md,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  emptyBody: {
    marginTop: spacing.xs,
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
