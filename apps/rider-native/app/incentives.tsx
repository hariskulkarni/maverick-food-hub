/**
 * Incentives screen — every active incentive slab the rider can chase right
 * now, each rendered as a live progress card.
 *
 * Wired to GET /api/rider/incentives. Pull-to-refresh re-fetches progress.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  SafeAreaView,
  Pressable,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { payments, type Incentive } from '../lib/api-payments';
import { IncentiveProgressCard } from '../components/incentive-progress-card';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

export default function IncentivesScreen() {
  const [incentives, setIncentives] = useState<Incentive[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await payments.incentives();
      setIncentives(res.incentives);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load incentives.');
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

  // Headline: total bonus still up for grabs (not yet achieved).
  const upForGrabs = useMemo(
    () =>
      (incentives ?? [])
        .filter((i) => !i.achieved)
        .reduce((s, i) => s + i.bonusAmount, 0),
    [incentives]
  );
  const achievedCount = useMemo(
    () => (incentives ?? []).filter((i) => i.achieved).length,
    [incentives]
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Back header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Incentives</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          {(incentives?.length ?? 0) > 0 ? (
            <>
              {/* Hero */}
              <View style={styles.hero}>
                <Text style={styles.heroLabel}>BONUS UP FOR GRABS</Text>
                <Text style={styles.heroAmount}>{rupees(upForGrabs)}</Text>
                <Text style={styles.heroSub}>
                  {achievedCount > 0
                    ? `${achievedCount} already achieved 🎉 — keep going!`
                    : 'Hit the delivery targets below to unlock these bonuses'}
                </Text>
              </View>

              <Text style={styles.sectionLabel}>ACTIVE INCENTIVES</Text>
              <View style={styles.cardList}>
                {incentives!.map((inc) => (
                  <IncentiveProgressCard key={inc.id} incentive={inc} />
                ))}
              </View>
            </>
          ) : (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="gift-outline" size={32} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No incentives running right now</Text>
              <Text style={styles.emptyText}>
                Check back soon — new delivery bonuses and weekend boosts are added
                regularly. When one goes live, you&apos;ll see your live progress here.
              </Text>
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
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.white,
    opacity: 0.85,
    letterSpacing: 1.5,
  },
  heroAmount: {
    fontSize: 40,
    fontWeight: font.weight.bold,
    color: colors.white,
    marginTop: spacing.xs,
  },
  heroSub: {
    fontSize: font.size.sm,
    color: colors.white,
    opacity: 0.9,
    marginTop: 2,
    lineHeight: 19,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  cardList: { gap: spacing.md },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
