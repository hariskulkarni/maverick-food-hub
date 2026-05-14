/**
 * Cash in Hand screen — tracks cash-on-delivery money the rider is holding and
 * needs to deposit, plus the full COD collection history grouped by status.
 *
 * Wired to GET /api/rider/cod. Pull-to-refresh re-fetches.
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
import { payments, type CodResponse, type CodCollection, type CodStatus } from '../lib/api-payments';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '₹0';
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

interface StatusMeta {
  label: string;
  bg: string;
  fg: string;
  /** Section heading for the grouped list. */
  group: string;
  order: number;
}

const STATUS_META: Record<CodStatus, StatusMeta> = {
  PENDING_COLLECTION: {
    label: 'To collect',
    bg: '#fdf4e3',
    fg: colors.warning,
    group: 'Still to collect',
    order: 0,
  },
  COLLECTED: {
    label: 'Collected',
    bg: colors.successSoft,
    fg: colors.success,
    group: 'Cash in hand — deposit soon',
    order: 1,
  },
  PARTIAL_COLLECTED: {
    label: 'Partial',
    bg: '#fdf4e3',
    fg: colors.warning,
    group: 'Cash in hand — deposit soon',
    order: 1,
  },
  DEPOSIT_PENDING: {
    label: 'Deposit pending',
    bg: '#fdf4e3',
    fg: colors.warning,
    group: 'Cash in hand — deposit soon',
    order: 1,
  },
  MISMATCH: {
    label: 'Mismatch',
    bg: colors.dangerSoft,
    fg: colors.danger,
    group: 'Needs attention',
    order: 2,
  },
  RECONCILED: {
    label: 'Reconciled',
    bg: colors.successSoft,
    fg: colors.success,
    group: 'Settled',
    order: 3,
  },
  WAIVED: {
    label: 'Waived',
    bg: colors.bg,
    fg: colors.textMuted,
    group: 'Settled',
    order: 3,
  },
};

interface Section {
  title: string;
  order: number;
  items: CodCollection[];
}

function groupCollections(collections: CodCollection[]): Section[] {
  const byGroup = new Map<string, Section>();
  for (const c of collections) {
    const meta = STATUS_META[c.status];
    let section = byGroup.get(meta.group);
    if (!section) {
      section = { title: meta.group, order: meta.order, items: [] };
      byGroup.set(meta.group, section);
    }
    section.items.push(c);
  }
  return [...byGroup.values()].sort((a, b) => a.order - b.order);
}

export default function CodTrackerScreen() {
  const [data, setData] = useState<CodResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await payments.cod());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your COD collections.');
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

  const sections = useMemo(() => groupCollections(data?.collections ?? []), [data]);
  const cashInHand = data?.cashInHand ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Back header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Cash in Hand</Text>
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

          {/* Cash hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>CASH TO DEPOSIT</Text>
            <Text style={styles.heroAmount}>{rupees(cashInHand)}</Text>
            <Text style={styles.heroSub}>
              {cashInHand > 0
                ? 'Hand this over at your branch to keep your account clean'
                : "You're all settled — no cash pending"}
            </Text>
          </View>

          {/* Explainer */}
          <View style={styles.explainer}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
            <Text style={styles.explainerText}>
              COD cash you collect from customers stays in your hand until you deposit it
              at the branch. Deposit regularly so your balance always reconciles.
            </Text>
          </View>

          {/* Grouped collections */}
          {sections.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="cash-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                No cash-on-delivery orders yet. COD collections will show up here once you
                deliver one.
              </Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.title}>
                <Text style={styles.sectionLabel}>{section.title.toUpperCase()}</Text>
                <View style={styles.list}>
                  {section.items.map((c) => {
                    const meta = STATUS_META[c.status];
                    const shown =
                      c.amountCollected != null ? c.amountCollected : c.amountToCollect;
                    return (
                      <View key={c.id} style={styles.row}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.rowCode}>{c.orderCode}</Text>
                          <Text style={styles.rowDate}>
                            {fmtWhen(c.collectedAt ?? c.createdAt)}
                          </Text>
                          {c.amountCollected != null &&
                          c.amountCollected !== c.amountToCollect ? (
                            <Text style={styles.rowMismatch}>
                              Expected {rupees(c.amountToCollect)}
                            </Text>
                          ) : null}
                          {c.notes ? (
                            <Text style={styles.rowNotes} numberOfLines={2}>
                              {c.notes}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.rowRight}>
                          <Text style={styles.rowAmount}>{rupees(shown)}</Text>
                          <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
                            <Text style={[styles.statusChipText, { color: meta.fg }]}>
                              {meta.label}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))
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

  explainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  explainerText: {
    flex: 1,
    fontSize: font.size.sm,
    color: colors.textMuted,
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
  list: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowLeft: { flex: 1 },
  rowCode: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  rowDate: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 1 },
  rowMismatch: {
    fontSize: font.size.xs,
    color: colors.danger,
    marginTop: 2,
  },
  rowNotes: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 2,
    fontStyle: 'italic',
  },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowAmount: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusChipText: { fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.4 },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  emptyText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },
});
