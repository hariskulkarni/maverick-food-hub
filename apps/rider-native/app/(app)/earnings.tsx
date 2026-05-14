/**
 * Earnings tab — goals, streaks, and a weekly breakdown that turn the raw
 * earnings feed into something motivating.
 *
 * Wired to GET /api/rider/earnings. Everything below the fetch is derived
 * client-side from that single payload: daily/weekly goal rings, a delivery
 * streak, a 7-day bar chart, and a per-delivery average. The downloadable
 * CSV/XLSX statement stays on the web; this is the at-a-glance in-app view.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, type EarningsSummary } from '../../lib/api';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';
import { ProgressRing } from '../../components/progress-ring';
import { SurgeBanner } from '../../components/surge-banner';
import { exportEarningsStatement } from '../../lib/export-statement';

/** Compact navigation tile into a payments sub-screen. */
function PayTile({
  icon,
  label,
  hint,
  route,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  route: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.payTile, pressed && styles.payTilePressed]}
      onPress={() => router.push(route as never)}
    >
      <View style={styles.payTileIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.payTileLabel}>{label}</Text>
      <Text style={styles.payTileHint}>{hint}</Text>
    </Pressable>
  );
}

const DAILY_GOAL = 1500;
const WEEKLY_GOAL = 9000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

/** Local YYYY-MM-DD key for a Date — used to bucket deliveries by day. */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DayBucket {
  key: string;
  label: string;
  total: number;
  count: number;
}

/** Build the last-7-days buckets (oldest → today) from the recent feed. */
function buildWeek(recent: EarningsSummary['recent']): DayBucket[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const r of recent) {
    if (!r.deliveredAt) continue;
    const k = dayKey(new Date(r.deliveredAt));
    const bucket = totals.get(k) ?? { total: 0, count: 0 };
    bucket.total += r.earnings;
    bucket.count += 1;
    totals.set(k, bucket);
  }

  const days: DayBucket[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const k = dayKey(d);
    const b = totals.get(k);
    days.push({
      key: k,
      label: WEEKDAYS[d.getDay()],
      total: b?.total ?? 0,
      count: b?.count ?? 0,
    });
  }
  return days;
}

/** Consecutive days with ≥1 delivery, counting back from today. */
function deliveryStreak(week: DayBucket[]): number {
  let streak = 0;
  for (let i = week.length - 1; i >= 0; i--) {
    if (week[i].count > 0) streak++;
    else break;
  }
  return streak;
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

  // Derive all the gamification stats from the single earnings payload.
  const week = useMemo(() => buildWeek(data?.recent ?? []), [data]);
  const weekTotal = useMemo(() => week.reduce((s, d) => s + d.total, 0), [week]);
  const maxDay = useMemo(
    () => week.reduce((m, d) => Math.max(m, d.total), 0),
    [week]
  );
  const streak = useMemo(() => deliveryStreak(week), [week]);

  const todayEarnings = data?.today.earnings ?? 0;
  const todayCount = data?.today.deliveries ?? 0;
  const lifeEarnings = data?.lifetime.totalEarnings ?? 0;
  const lifeDeliveries = data?.lifetime.totalDeliveries ?? 0;
  const perDelivery = lifeDeliveries > 0 ? lifeEarnings / lifeDeliveries : 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
        <View style={styles.titleRow}>
          <Text style={styles.title}>Earnings</Text>
          <Pressable
            style={({ pressed }) => [
              styles.exportBtn,
              pressed && styles.exportBtnPressed,
            ]}
            onPress={exportEarningsStatement}
            hitSlop={8}
          >
            <Ionicons name="share-outline" size={16} color={colors.primary} />
            <Text style={styles.exportBtnText}>Export</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        <View style={styles.surgeSlot}>
          <SurgeBanner />
        </View>

        {/* Today hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>TODAY</Text>
          <Text style={styles.heroAmount}>{rupees(todayEarnings)}</Text>
          <Text style={styles.heroSub}>
            {todayCount} deliver{todayCount === 1 ? 'y' : 'ies'} completed today
          </Text>
        </View>

        {/* Payments — instant payout, cash in hand, incentives */}
        <Text style={styles.sectionLabel}>PAYMENTS</Text>
        <View style={styles.payRow}>
          <PayTile
            icon="flash-outline"
            label="Instant Payout"
            hint="Withdraw to UPI"
            route="/payouts"
          />
          <PayTile
            icon="wallet-outline"
            label="Cash in Hand"
            hint="COD to deposit"
            route="/cod-tracker"
          />
          <PayTile
            icon="gift-outline"
            label="Incentives"
            hint="Bonus targets"
            route="/incentives"
          />
        </View>

        {/* Goal rings */}
        <Text style={styles.sectionLabel}>YOUR GOALS</Text>
        <View style={styles.goalCard}>
          <View style={styles.ringSlot}>
            <ProgressRing
              progress={todayEarnings / DAILY_GOAL}
              size={132}
              value={rupees(todayEarnings)}
              label={`of ${rupees(DAILY_GOAL)}`}
              color={colors.primary}
            />
            <Text style={styles.ringCaption}>Daily goal</Text>
            <Text style={styles.ringHint}>
              {todayEarnings >= DAILY_GOAL
                ? 'Goal smashed! 🎉'
                : `${rupees(DAILY_GOAL - todayEarnings)} to go`}
            </Text>
          </View>
          <View style={styles.ringDivider} />
          <View style={styles.ringSlot}>
            <ProgressRing
              progress={weekTotal / WEEKLY_GOAL}
              size={132}
              value={rupees(weekTotal)}
              label={`of ${rupees(WEEKLY_GOAL)}`}
              color={colors.success}
            />
            <Text style={styles.ringCaption}>Weekly goal</Text>
            <Text style={styles.ringHint}>
              {weekTotal >= WEEKLY_GOAL
                ? 'Goal smashed! 🎉'
                : `${rupees(WEEKLY_GOAL - weekTotal)} to go`}
            </Text>
          </View>
        </View>

        {/* Streak + per-delivery average */}
        <View style={styles.statRow}>
          <View style={[styles.statCard, styles.streakCard]}>
            <Text style={styles.streakValue}>🔥 {streak}</Text>
            <Text style={styles.statLabel}>
              {streak === 1 ? 'day streak' : 'day streak'}
            </Text>
            <Text style={styles.streakHint}>
              {streak === 0
                ? 'Deliver today to start a streak'
                : 'Consecutive days delivering'}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{rupees(perDelivery)}</Text>
            <Text style={styles.statLabel}>Avg per delivery</Text>
            <Text style={styles.streakHint}>Across {lifeDeliveries} runs</Text>
          </View>
        </View>

        {/* Weekly bar chart */}
        <Text style={styles.sectionLabel}>THIS WEEK</Text>
        <View style={styles.chartCard}>
          <View style={styles.chartRow}>
            {week.map((d) => {
              const pct = maxDay > 0 ? d.total / maxDay : 0;
              const barH = Math.max(d.total > 0 ? 6 : 2, Math.round(pct * 96));
              const isToday = d.key === week[week.length - 1].key;
              return (
                <View key={d.key} style={styles.barCol}>
                  <Text style={styles.barValue} numberOfLines={1}>
                    {d.total > 0 ? rupees(d.total) : ''}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barH,
                          backgroundColor: isToday
                            ? colors.primary
                            : colors.primarySoft,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[styles.barLabel, isToday && styles.barLabelToday]}
                  >
                    {d.label}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.chartFooter}>
            <Text style={styles.chartFooterText}>
              {rupees(weekTotal)} earned over the last 7 days
            </Text>
          </View>
        </View>

        {/* Lifetime grid */}
        <Text style={styles.sectionLabel}>LIFETIME</Text>
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{rupees(lifeEarnings)}</Text>
            <Text style={styles.statLabel}>Lifetime earnings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{lifeDeliveries}</Text>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  exportBtnPressed: { opacity: 0.6 },
  exportBtnText: {
    fontSize: font.size.sm,
    color: colors.primary,
    fontWeight: font.weight.semibold,
  },

  surgeSlot: { marginBottom: spacing.md },

  payRow: { flexDirection: 'row', gap: spacing.sm },
  payTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  payTilePressed: { backgroundColor: colors.primarySoft },
  payTileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  payTileLabel: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  payTileHint: {
    fontSize: 11,
    color: colors.textMuted,
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

  // Goal rings
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    ...shadow.card,
  },
  ringSlot: { flex: 1, alignItems: 'center' },
  ringDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  ringCaption: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  ringHint: {
    marginTop: 2,
    fontSize: font.size.xs,
    color: colors.textMuted,
  },

  // Stat grid
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
  streakCard: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  streakValue: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.primaryDark,
  },
  streakHint: {
    marginTop: spacing.xs,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
  },

  // Weekly bar chart
  chartCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 140,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barValue: {
    fontSize: 9,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    fontWeight: font.weight.semibold,
  },
  barTrack: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: 100,
  },
  bar: {
    width: '62%',
    borderRadius: radius.sm,
  },
  barLabel: {
    marginTop: spacing.sm,
    fontSize: font.size.xs,
    color: colors.textMuted,
  },
  barLabelToday: {
    color: colors.primaryDark,
    fontWeight: font.weight.bold,
  },
  chartFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chartFooterText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
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
