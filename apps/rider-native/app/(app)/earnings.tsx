/**
 * Earnings tab — today's tally, lifetime stats, and recent delivered runs.
 * Wired to GET /api/rider/earnings. The downloadable CSV/XLSX statement stays
 * on the web; this is the at-a-glance in-app view.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, ApiError, type EarningsSummary } from '../../lib/api';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function EarningsScreen() {
  const [data, setData] = useState<EarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.earnings());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your earnings.');
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

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const todayCount = data?.today.deliveries ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
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
        <Text style={styles.title}>Earnings</Text>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        {/* Today hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>TODAY</Text>
          <Text style={styles.heroAmount}>{rupees(data?.today.earnings ?? 0)}</Text>
          <Text style={styles.heroSub}>
            {todayCount} deliver{todayCount === 1 ? 'y' : 'ies'} completed today
          </Text>
        </View>

        {/* Lifetime grid */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {rupees(data?.lifetime.totalEarnings ?? 0)}
            </Text>
            <Text style={styles.statLabel}>Lifetime earnings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{data?.lifetime.totalDeliveries ?? 0}</Text>
            <Text style={styles.statLabel}>Total deliveries</Text>
          </View>
        </View>
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{rupees(data?.lifetime.totalTips ?? 0)}</Text>
            <Text style={styles.statLabel}>Tips earned</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {(data?.lifetime.rating ?? 5).toFixed(1)} ★
            </Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
        </View>

        {/* Recent deliveries */}
        <Text style={styles.sectionLabel}>RECENT DELIVERIES</Text>
        {(data?.recent.length ?? 0) === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No completed deliveries yet — finish a run and it shows up here.
            </Text>
          </View>
        ) : (
          <View style={styles.recentList}>
            {data!.recent.map((r) => (
              <View key={r.id} style={styles.recentRow}>
                <View style={styles.recentLeft}>
                  <Text style={styles.recentCode}>{r.orderCode}</Text>
                  <Text style={styles.recentDate}>{fmtWhen(r.deliveredAt)}</Text>
                </View>
                <View style={styles.recentRight}>
                  <Text style={styles.recentAmount}>{rupees(r.earnings)}</Text>
                  {r.tip > 0 ? (
                    <Text style={styles.recentTip}>incl. {rupees(r.tip)} tip</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginBottom: spacing.md,
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
  },

  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  statLabel: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  recentList: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  recentLeft: { flex: 1 },
  recentCode: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  recentDate: { fontSize: font.size.sm, color: colors.textMuted, marginTop: 1 },
  recentRight: { alignItems: 'flex-end' },
  recentAmount: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.success,
  },
  recentTip: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 1 },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
