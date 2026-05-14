/**
 * Activity tab — a unified, newest-first feed of the rider's recent activity.
 *
 * Merges two sources into one timeline:
 *   • api.assignments() — active runs (PENDING / ACCEPTED / PICKED_UP)
 *   • api.earnings().recent — completed, delivered runs (with payout)
 *
 * Each row is timestamped with a status icon + theme colour. Mirrors the
 * load / refresh / loading / empty structure of the Earnings screen.
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
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  ApiError,
  type Assignment,
  type AssignmentStatus,
  type EarningsSummary,
} from '../../lib/api';
import { colors, spacing, radius, font } from '../../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface FeedItem {
  key: string;
  label: string;
  code: string;
  /** ISO timestamp used for ordering + display; null when unknown. */
  when: string | null;
  amount: number | null;
  icon: IconName;
  iconColor: string;
}

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

function fmtWhen(iso: string | null): string {
  if (!iso) return 'Time n/a';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Best-known timestamp for an active assignment, given its status. */
function assignmentWhen(a: Assignment): string | null {
  return a.pickedUpAt ?? a.acceptedAt ?? a.assignedAt ?? null;
}

function activeLabel(status: AssignmentStatus): {
  label: string;
  icon: IconName;
  color: string;
} {
  switch (status) {
    case 'PICKED_UP':
      return { label: 'Out for delivery', icon: 'bicycle', color: colors.primary };
    case 'ACCEPTED':
      return { label: 'Heading to restaurant', icon: 'storefront-outline', color: colors.warning };
    case 'PENDING':
    default:
      return { label: 'New assignment', icon: 'time-outline', color: colors.textMuted };
  }
}

function buildFeed(
  assignments: Assignment[],
  earnings: EarningsSummary | null
): FeedItem[] {
  const items: FeedItem[] = [];

  for (const a of assignments) {
    const meta = activeLabel(a.status);
    items.push({
      key: `assignment-${a.id}`,
      label: meta.label,
      code: a.order.code,
      when: assignmentWhen(a),
      amount: null,
      icon: meta.icon,
      iconColor: meta.color,
    });
  }

  for (const r of earnings?.recent ?? []) {
    items.push({
      key: `delivered-${r.id}`,
      label: 'Delivered',
      code: r.orderCode,
      when: r.deliveredAt,
      amount: r.earnings,
      icon: 'checkmark-circle',
      iconColor: colors.success,
    });
  }

  // Newest first; rows with no timestamp sink to the bottom.
  return items.sort((a, b) => {
    const ta = a.when ? new Date(a.when).getTime() : 0;
    const tb = b.when ? new Date(b.when).getTime() : 0;
    return tb - ta;
  });
}

export default function ActivityScreen() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [assignments, earnings] = await Promise.all([
        api.assignments(),
        api.earnings(),
      ]);
      setFeed(buildFeed(assignments, earnings));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your activity.');
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
        <Text style={styles.title}>Activity</Text>
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        {feed.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              Claim an order and your runs — active and completed — will show up
              here, newest first.
            </Text>
          </View>
        ) : (
          <View style={styles.feedList}>
            {feed.map((item) => (
              <View key={item.key} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons name={item.icon} size={20} color={item.iconColor} />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>
                    {item.label} · {item.code}
                    {item.amount != null ? ` · ${rupees(item.amount)}` : ''}
                  </Text>
                  <Text style={styles.rowWhen}>{fmtWhen(item.when)}</Text>
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

  feedList: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowBody: { flex: 1 },
  rowLabel: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  rowWhen: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: 1,
  },

  emptyCard: {
    marginTop: spacing.xl,
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
