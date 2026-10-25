/**
 * Help center — search and browse rider help articles.
 *
 * Wired to GET /api/rider/help (topics) and /api/rider/help/search. The topic
 * index is cached on the device after each successful load; with no
 * connection the screen shows the saved copy and searches it locally.
 * Opened from Help & Support.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import {
  help,
  indexKey,
  readCache,
  splitHighlight,
  type HelpCategory,
  type HelpLang,
  type HelpSearchHit,
} from '../lib/api-help';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

function fmtSaved(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function Highlighted({ text, style }: { text: string; style: object }) {
  return (
    <Text style={style}>
      {splitHighlight(text).map((s, i) =>
        s.hit ? (
          <Text key={i} style={styles.hl}>
            {s.v}
          </Text>
        ) : (
          <Text key={i}>{s.v}</Text>
        )
      )}
    </Text>
  );
}

export default function HelpScreen() {
  const [lang, setLang] = useState<HelpLang>('en');
  const [categories, setCategories] = useState<HelpCategory[] | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HelpSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCategories(await help.categories(lang));
      setOfflineSince(null);
    } catch (e) {
      const cached = await readCache<HelpCategory[]>(indexKey(lang));
      if (cached) {
        setCategories(cached.data);
        setOfflineSince(cached.savedAt);
      } else {
        setCategories(null);
        setError(e instanceof ApiError ? e.message : 'Could not load help articles.');
      }
    }
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Local filter over the cached index — used when offline.
  const localHits = useMemo<HelpSearchHit[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term || !categories) return [];
    return categories
      .flatMap((c) => c.articles.map((a) => ({ ...a, categoryTitle: c.title })))
      .filter((a) => a.title.toLowerCase().includes(term) || a.summary.toLowerCase().includes(term))
      .map((a) => ({ slug: a.slug, title: a.title, titleHl: a.title, summary: a.summary, snippet: '', categoryTitle: a.categoryTitle }));
  }, [q, categories]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await help.search(term, lang);
        if (!cancelled) setHits(r);
      } catch {
        if (!cancelled) setHits(localHits);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, lang, localHits]);

  const openArticle = (slug: string) => router.push({ pathname: '/help-article', params: { slug, lang } });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader
        title={lang === 'hi' ? 'सहायता केंद्र' : 'Help center'}
        right={
          <Pressable
            onPress={() => setLang((l) => (l === 'en' ? 'hi' : 'en'))}
            style={styles.langBtn}
            accessibilityRole="button"
            accessibilityLabel="Switch language"
          >
            <Text style={styles.langText}>{lang === 'en' ? 'हिं' : 'EN'}</Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={lang === 'hi' ? 'सहायता खोजें…' : 'Search help…'}
            placeholderTextColor={colors.textMuted}
            maxLength={100}
            returnKeyType="search"
            accessibilityLabel="Search help articles"
          />
          {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>

        {offlineSince ? (
          <Text style={styles.offline}>
            You are offline — showing help saved on {fmtSaved(offlineSince)}.
          </Text>
        ) : null}
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        {hits !== null ? (
          <View>
            <Text style={styles.sectionLabel}>
              {hits.length ? `${hits.length} RESULT${hits.length === 1 ? '' : 'S'}` : 'NO MATCHING ARTICLES'}
            </Text>
            {hits.length === 0 ? (
              <Text style={styles.muted}>Try other words, or raise a support ticket from Help & Support.</Text>
            ) : (
              <View style={styles.card}>
                {hits.map((h, i) => (
                  <Pressable
                    key={h.slug}
                    onPress={() => openArticle(h.slug)}
                    style={({ pressed }) => [styles.row, i === hits.length - 1 && styles.rowLast, pressed && styles.pressed]}
                  >
                    <View style={styles.rowText}>
                      <Highlighted text={h.titleHl} style={styles.rowTitle} />
                      {h.snippet ? (
                        <Highlighted text={h.snippet} style={styles.rowSub} />
                      ) : (
                        <Text style={styles.rowSub} numberOfLines={2}>{h.summary}</Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : categories && categories.length === 0 ? (
          <Text style={styles.muted}>No help articles have been published yet.</Text>
        ) : (
          (categories ?? []).map((c) => (
            <View key={c.slug}>
              <Text style={styles.sectionLabel}>{c.title.toUpperCase()}</Text>
              <View style={styles.card}>
                {c.articles.map((a, i) => (
                  <Pressable
                    key={a.slug}
                    onPress={() => openArticle(a.slug)}
                    style={({ pressed }) => [styles.row, i === c.articles.length - 1 && styles.rowLast, pressed && styles.pressed]}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{a.title}</Text>
                      <Text style={styles.rowSub} numberOfLines={2}>{a.summary}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        )}

        <Pressable style={({ pressed }) => [styles.supportBtn, pressed && styles.pressed]} onPress={() => router.push('/support')}>
          <Ionicons name="chatbubbles-outline" size={18} color={colors.primary} />
          <Text style={styles.supportText}>Still stuck? Raise a support ticket</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  pressed: { opacity: 0.7 },
  langBtn: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langText: { color: colors.primary, fontWeight: font.weight.bold, fontSize: font.size.sm },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
  },
  searchInput: { flex: 1, fontSize: font.size.md, color: colors.text },
  hl: { backgroundColor: colors.primarySoft, color: colors.primaryDark, fontWeight: font.weight.semibold },
  offline: {
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
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
  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  muted: { marginTop: spacing.md, color: colors.textMuted, fontSize: font.size.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  rowSub: { fontSize: font.size.sm, color: colors.textMuted },
  supportBtn: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  supportText: { color: colors.primary, fontWeight: font.weight.semibold, fontSize: font.size.md },
});
