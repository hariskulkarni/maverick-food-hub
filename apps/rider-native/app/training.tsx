/**
 * Training & Certification — the rider's training library.
 *
 * Progress header, a "required training" banner, Required and Optional
 * sections (with per-module progress), a language switch (English / Hindi when
 * content exists) and a link to certificates.
 *
 * Offline-friendly: the last library fetched is cached on the device and shown
 * immediately (and when there is no network), with a "saved N min ago" note.
 *
 * Wired to GET /api/rider/training.
 */
import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { growth, type TrainingResponse, type TrainingModuleSummary, type TrainingLang } from '../lib/api-growth';
import { cacheKeys, getTrainingLang, readCache, savedAgo, setTrainingLang, writeCache } from '../lib/training-cache';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { ProgressRing } from '../components/progress-ring';

const STATE_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  QUIZ_READY: 'Quiz pending',
  CERTIFIED: 'Certified',
  RECERT_REQUIRED: 'Re-certify',
};

export default function TrainingScreen() {
  const [lang, setLang] = useState<TrainingLang>('en');
  const [data, setData] = useState<TrainingResponse | null>(null);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (l: TrainingLang) => {
    setError(null);
    try {
      const fresh = await growth.training(l);
      setData(fresh);
      setOfflineSince(null);
      writeCache(cacheKeys.library(l), fresh);
    } catch (e) {
      const cached = await readCache<TrainingResponse>(cacheKeys.library(l));
      if (cached) {
        setData(cached.data);
        setOfflineSince(cached.savedAt);
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not load your training.');
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const l = await getTrainingLang();
        if (cancelled) return;
        setLang(l);
        // Paint the cached copy first so the screen is instant (and works offline).
        const cached = await readCache<TrainingResponse>(cacheKeys.library(l));
        if (cached && !cancelled) {
          setData((d) => d ?? cached.data);
          setLoading(false);
        }
        await load(l);
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(lang);
    setRefreshing(false);
  }, [load, lang]);

  const switchLang = useCallback(
    async (l: TrainingLang) => {
      setLang(l);
      setTrainingLang(l);
      setRefreshing(true);
      await load(l);
      setRefreshing(false);
    },
    [load]
  );

  const required = useMemo(() => (data?.modules ?? []).filter((m) => m.isRequired), [data]);
  const optional = useMemo(() => (data?.modules ?? []).filter((m) => !m.isRequired), [data]);
  const hasHindi = (data?.modules ?? []).some((m) => m.languages?.includes('hi'));

  const completed = data?.completedCount ?? 0;
  const total = data?.totalCount ?? 0;
  const requiredRemaining = data?.requiredRemaining ?? 0;
  const overdue = data?.requiredOverdue ?? 0;
  const recert = data?.recertRequired ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader
        title="Training"
        right={
          <Pressable onPress={() => router.push('/training-certificates')} hitSlop={10} accessibilityLabel="Certificates">
            <Ionicons name="ribbon-outline" size={22} color={colors.primary} />
          </Pressable>
        }
      />

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={onRefresh}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        >
          {offlineSince ? (
            <View style={styles.offline}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.textMuted} />
              <Text style={styles.offlineText}>Offline. Showing training saved {savedAgo(offlineSince)}.</Text>
            </View>
          ) : null}

          <View style={styles.progressCard}>
            <ProgressRing progress={total > 0 ? completed / total : 0} size={96} value={`${completed}/${total}`} label="certified" color={colors.primary} />
            <View style={styles.progressText}>
              <Text style={styles.progressTitle}>
                {total > 0 && requiredRemaining === 0 ? 'Required training complete' : `${completed} of ${total} modules certified`}
              </Text>
              <Text style={styles.progressSub}>
                {total === 0
                  ? 'No training modules are available right now.'
                  : requiredRemaining > 0
                    ? `${requiredRemaining} required module${requiredRemaining === 1 ? '' : 's'} left.`
                    : 'You hold a current certificate for every required module.'}
              </Text>
            </View>
          </View>

          {requiredRemaining > 0 ? (
            <View style={[styles.banner, overdue > 0 && styles.bannerDanger]}>
              <Ionicons name="alert-circle" size={20} color={overdue > 0 ? colors.danger : colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>
                  {overdue > 0 ? `${overdue} required module${overdue === 1 ? ' is' : 's are'} overdue` : 'Required training pending'}
                </Text>
                {recert > 0 ? (
                  <Text style={styles.bannerBody}>
                    {recert} module{recert === 1 ? ' was' : 's were'} updated. Redo the lessons and quiz to re-certify.
                  </Text>
                ) : (
                  <Text style={styles.bannerBody}>Finish the lessons and pass the quiz for each required module.</Text>
                )}
              </View>
            </View>
          ) : null}

          {hasHindi ? (
            <View style={styles.langRow}>
              {(['en', 'hi'] as TrainingLang[]).map((l) => (
                <Pressable key={l} onPress={() => switchLang(l)} style={[styles.langChip, lang === l && styles.langChipOn]}>
                  <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l === 'en' ? 'English' : 'हिन्दी'}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Section title="REQUIRED" modules={required} />
          <Section title="OPTIONAL" modules={optional} />
          {total === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No training modules yet. Check back soon.</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Section({ title, modules }: { title: string; modules: TrainingModuleSummary[] }) {
  if (modules.length === 0) return null;
  return (
    <View>
      <Text style={styles.groupLabel}>{title}</Text>
      <View style={styles.list}>
        {modules.map((m, i) => {
          const st = m.status;
          const pct = st?.progressPct ?? (m.completed ? 100 : 0);
          const label = st ? (st.overdue && !m.completed ? 'Overdue' : STATE_LABEL[st.state] ?? st.state) : m.completed ? 'Completed' : 'Start';
          const bad = !m.completed && (st?.overdue || st?.needsRecert);
          return (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.moduleRow, i === modules.length - 1 && styles.moduleRowLast, pressed && styles.moduleRowPressed]}
              onPress={() => router.push({ pathname: '/training-module', params: { id: m.id } })}
            >
              <View style={[styles.statusIcon, m.completed && styles.statusIconDone, bad && styles.statusIconBad]}>
                <Ionicons
                  name={m.completed ? 'checkmark' : bad ? 'refresh' : 'play'}
                  size={16}
                  color={m.completed || bad ? colors.white : colors.primary}
                />
              </View>
              <View style={styles.moduleText}>
                <Text style={styles.moduleTitle} numberOfLines={2}>{m.title}</Text>
                <View style={styles.moduleMetaRow}>
                  <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.moduleMeta}>
                    {m.durationMin} min{m.lessonsCount ? ` · ${m.lessonsCount} lessons` : ''}
                  </Text>
                  <Text style={[styles.stateText, m.completed && { color: colors.success }, bad && { color: colors.danger }]}>· {label}</Text>
                </View>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${pct}%` }, m.completed && { backgroundColor: colors.success }]} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  errorText: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  retryBtnText: { color: colors.primary, fontWeight: font.weight.semibold, fontSize: font.size.sm },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  offline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  offlineText: { flex: 1, fontSize: font.size.xs, color: colors.textMuted },
  progressCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadow.card },
  progressText: { flex: 1 },
  progressTitle: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  progressSub: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 19, marginTop: spacing.xs },
  banner: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningSoft, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.md },
  bannerDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  bannerTitle: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: colors.text },
  bannerBody: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  langRow: { flexDirection: 'row', gap: spacing.sm },
  langChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  langChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  langText: { fontSize: font.size.sm, color: colors.textMuted, fontWeight: font.weight.medium },
  langTextOn: { color: colors.primary },
  groupLabel: { fontSize: font.size.xs, fontWeight: font.weight.bold, color: colors.textMuted, letterSpacing: 1.2, marginTop: spacing.sm, marginBottom: spacing.sm },
  list: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  moduleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  moduleRowLast: { borderBottomWidth: 0 },
  moduleRowPressed: { backgroundColor: colors.primarySoft },
  statusIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  statusIconDone: { backgroundColor: colors.success },
  statusIconBad: { backgroundColor: colors.danger },
  moduleText: { flex: 1 },
  moduleTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  moduleMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
  moduleMeta: { fontSize: font.size.xs, color: colors.textMuted },
  stateText: { fontSize: font.size.xs, color: colors.textMuted, fontWeight: font.weight.semibold },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.sm, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.primary },
  emptyCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  emptyText: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
});
