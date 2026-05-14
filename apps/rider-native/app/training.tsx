/**
 * Training & Certification — the rider's learning catalogue.
 *
 * An overall progress header (ProgressRing + "N of M complete"), modules
 * grouped by category, each row showing title, duration, required flag, and a
 * completed checkmark or "Start" affordance. Tapping a module opens it.
 *
 * Wired to GET /api/rider/training.
 */
import { useState, useCallback, useMemo } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import {
  growth,
  type TrainingResponse,
  type TrainingModuleSummary,
  type TrainingCategory,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { ProgressRing } from '../components/progress-ring';

const CATEGORY_META: Record<
  TrainingCategory,
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  ONBOARDING: { label: 'Getting started', icon: 'rocket-outline' },
  SAFETY: { label: 'Safety', icon: 'shield-checkmark-outline' },
  CUSTOMER_SERVICE: { label: 'Customer service', icon: 'happy-outline' },
  EARNINGS: { label: 'Earnings & incentives', icon: 'cash-outline' },
  APP_GUIDE: { label: 'Using the app', icon: 'phone-portrait-outline' },
};

const CATEGORY_ORDER: TrainingCategory[] = [
  'ONBOARDING',
  'SAFETY',
  'CUSTOMER_SERVICE',
  'EARNINGS',
  'APP_GUIDE',
];

export default function TrainingScreen() {
  const [data, setData] = useState<TrainingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await growth.training());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your training.');
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

  // Bucket modules by category, preserving the catalogue's `order` within each.
  const grouped = useMemo(() => {
    const map = new Map<TrainingCategory, TrainingModuleSummary[]>();
    for (const m of data?.modules ?? []) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      modules: (map.get(c) ?? []).slice().sort((a, b) => a.order - b.order),
    }));
  }, [data]);

  const completed = data?.completedCount ?? 0;
  const total = data?.totalCount ?? 0;
  const requiredRemaining = data?.requiredRemaining ?? 0;
  const progress = total > 0 ? completed / total : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Training" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              setLoading(true);
              load().then(() => setLoading(false));
            }}
          >
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
          {/* Progress header */}
          <View style={styles.progressCard}>
            <ProgressRing
              progress={progress}
              size={104}
              value={`${completed}/${total}`}
              label="modules"
              color={colors.primary}
            />
            <View style={styles.progressText}>
              <Text style={styles.progressTitle}>
                {total > 0 && completed === total
                  ? 'All modules complete!'
                  : `${completed} of ${total} modules complete`}
              </Text>
              <Text style={styles.progressSub}>
                {requiredRemaining > 0
                  ? `${requiredRemaining} required module${
                      requiredRemaining === 1 ? '' : 's'
                    } left to finish your certification.`
                  : total === 0
                    ? 'No training modules are available right now.'
                    : 'Every required module is done — you are fully certified.'}
              </Text>
            </View>
          </View>

          {/* Grouped modules */}
          {grouped.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No training modules yet — check back soon.
              </Text>
            </View>
          ) : (
            grouped.map((group) => {
              const meta = CATEGORY_META[group.category];
              return (
                <View key={group.category}>
                  <View style={styles.groupHeader}>
                    <Ionicons name={meta.icon} size={16} color={colors.textMuted} />
                    <Text style={styles.groupLabel}>
                      {meta.label.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.list}>
                    {group.modules.map((m, i) => (
                      <Pressable
                        key={m.id}
                        style={({ pressed }) => [
                          styles.moduleRow,
                          i === group.modules.length - 1 && styles.moduleRowLast,
                          pressed && styles.moduleRowPressed,
                        ]}
                        onPress={() =>
                          router.push({
                            pathname: '/training-module',
                            params: { id: m.id },
                          })
                        }
                      >
                        <View
                          style={[
                            styles.statusIcon,
                            m.completed && styles.statusIconDone,
                          ]}
                        >
                          <Ionicons
                            name={m.completed ? 'checkmark' : 'play'}
                            size={16}
                            color={m.completed ? colors.white : colors.primary}
                          />
                        </View>
                        <View style={styles.moduleText}>
                          <Text style={styles.moduleTitle} numberOfLines={2}>
                            {m.title}
                          </Text>
                          <View style={styles.moduleMetaRow}>
                            <Ionicons
                              name="time-outline"
                              size={12}
                              color={colors.textMuted}
                            />
                            <Text style={styles.moduleMeta}>
                              {m.durationMin} min
                            </Text>
                            {m.isRequired ? (
                              <View style={styles.requiredPill}>
                                <Text style={styles.requiredPillText}>
                                  REQUIRED
                                </Text>
                              </View>
                            ) : null}
                            {m.completed ? (
                              <Text style={styles.doneText}>Completed</Text>
                            ) : null}
                          </View>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })
          )}
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
  errorText: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
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

  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  progressText: { flex: 1 },
  progressTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  progressSub: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: spacing.xs,
  },

  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  groupLabel: {
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
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moduleRowLast: { borderBottomWidth: 0 },
  moduleRowPressed: { backgroundColor: colors.primarySoft },
  statusIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconDone: { backgroundColor: colors.success },
  moduleText: { flex: 1 },
  moduleTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  moduleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  moduleMeta: { fontSize: font.size.xs, color: colors.textMuted },
  requiredPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginLeft: spacing.xs,
  },
  requiredPillText: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  doneText: {
    fontSize: font.size.xs,
    color: colors.success,
    fontWeight: font.weight.semibold,
    marginLeft: spacing.xs,
  },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginTop: spacing.lg,
  },
  emptyText: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
});
