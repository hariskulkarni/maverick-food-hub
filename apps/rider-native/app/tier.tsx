/**
 * My Tier — the rider's loyalty-ladder standing.
 *
 * A hero with the current tier badge and a ProgressRing toward the next rung,
 * the perks unlocked at the current tier, and an "all tiers" overview that
 * compares every rung's requirement + perks with the rider's own highlighted.
 *
 * Wired to GET /api/rider/tier.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { growth, type TierResponse } from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { ProgressRing } from '../components/progress-ring';
import { TierBadge } from '../components/tier-badge';
import { ScreenHeader } from '../components/screen-header';

export default function TierScreen() {
  const [data, setData] = useState<TierResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await growth.tier());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your tier.');
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
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="My Tier" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); load().then(() => setLoading(false)); }}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : data ? (
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
          {/* Hero */}
          <View style={styles.hero}>
            <TierBadge tier={data.current.name} size="lg" />
            {data.next ? (
              <>
                <View style={styles.ringWrap}>
                  <ProgressRing
                    progress={data.progressToNext}
                    size={150}
                    value={`${Math.round(data.progressToNext * 100)}%`}
                    label={`to ${data.next.name}`}
                    color={colors.primary}
                  />
                </View>
                <Text style={styles.heroHint}>
                  {data.next.requirement} to reach{' '}
                  <Text style={styles.heroHintBold}>{data.next.name}</Text>
                </Text>
              </>
            ) : (
              <View style={styles.maxedWrap}>
                <Ionicons name="trophy" size={44} color={colors.primary} />
                <Text style={styles.maxedTitle}>Top tier reached!</Text>
                <Text style={styles.heroHint}>
                  You&apos;re a Platinum rider — the highest rung on the ladder.
                </Text>
              </View>
            )}
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{data.stats.totalDeliveries}</Text>
                <Text style={styles.statLabel}>Deliveries</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statValue}>{data.stats.rating.toFixed(1)} ★</Text>
                <Text style={styles.statLabel}>Rating</Text>
              </View>
            </View>
          </View>

          {/* Current perks */}
          <Text style={styles.sectionLabel}>YOUR {data.current.name} PERKS</Text>
          <View style={styles.card}>
            {data.perks.map((perk, i) => (
              <View
                key={perk}
                style={[styles.perkRow, i === data.perks.length - 1 && styles.perkRowLast]}
              >
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}
          </View>

          {/* All tiers overview */}
          <Text style={styles.sectionLabel}>ALL TIERS</Text>
          {data.allTiers.map((t) => {
            const isCurrent = t.name === data.current.name;
            return (
              <View
                key={t.name}
                style={[styles.tierCard, isCurrent && styles.tierCardCurrent]}
              >
                <View style={styles.tierCardHeader}>
                  <TierBadge tier={t.name} size="sm" />
                  {isCurrent ? (
                    <View style={styles.youPill}>
                      <Text style={styles.youPillText}>YOU</Text>
                    </View>
                  ) : t.achieved ? (
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  ) : (
                    <Ionicons name="lock-closed" size={15} color={colors.textMuted} />
                  )}
                </View>
                <Text style={styles.tierReq}>{t.requirement}</Text>
                <View style={styles.tierPerks}>
                  {t.perks.map((perk) => (
                    <View key={perk} style={styles.tierPerkRow}>
                      <View style={styles.tierPerkDot} />
                      <Text style={styles.tierPerkText}>{perk}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  errorText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryBtnText: {
    color: colors.primary,
    fontWeight: font.weight.semibold,
    fontSize: font.size.sm,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },

  hero: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    ...shadow.card,
  },
  ringWrap: { marginTop: spacing.lg },
  heroHint: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  heroHintBold: { color: colors.text, fontWeight: font.weight.bold },
  maxedWrap: { alignItems: 'center', marginTop: spacing.lg, gap: spacing.xs },
  maxedTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: 'stretch',
  },
  statBox: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },
  statValue: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  statLabel: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  perkRowLast: { borderBottomWidth: 0 },
  perkText: { flex: 1, fontSize: font.size.sm, color: colors.text, lineHeight: 20 },

  tierCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  tierCardCurrent: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  tierCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  youPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  youPillText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 1,
  },
  tierReq: {
    marginTop: spacing.sm,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  tierPerks: { marginTop: spacing.sm, gap: spacing.xs },
  tierPerkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierPerkDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },
  tierPerkText: {
    flex: 1,
    fontSize: font.size.xs,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
