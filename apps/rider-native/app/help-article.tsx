/**
 * One help article — body, "Was this helpful?" feedback and related articles.
 *
 * Wired to GET /api/rider/help/articles/[slug] and POST …/feedback. Each
 * article is cached after it loads, so a previously opened article still
 * opens offline.
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { HelpBlocks } from '../components/help-blocks';
import { help, articleKey, readCache, type HelpArticle, type HelpLang } from '../lib/api-help';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

export default function HelpArticleScreen() {
  const params = useLocalSearchParams<{ slug: string; lang?: string }>();
  const slug = String(params.slug ?? '');
  const [lang, setLang] = useState<HelpLang>(params.lang === 'hi' ? 'hi' : 'en');
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [vote, setVote] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setArticle(await help.article(slug, lang));
      setOfflineSince(null);
    } catch (e) {
      const cached = await readCache<HelpArticle>(articleKey(slug, lang));
      if (cached && !(e instanceof ApiError && e.status === 404)) {
        setArticle(cached.data);
        setOfflineSince(cached.savedAt);
      } else {
        setArticle(null);
        setError(
          e instanceof ApiError && e.status === 0
            ? 'You are offline and this article has not been saved on this phone yet.'
            : e instanceof ApiError
              ? e.message
              : 'Could not load this article.'
        );
      }
    }
  }, [slug, lang]);

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

  async function sendFeedback(helpful: boolean, withComment: boolean) {
    if (!article || sending) return;
    setSending(true);
    try {
      await help.feedback(article.slug, article.language, helpful, withComment ? comment : undefined);
      setVote(helpful);
      if (withComment) setSent(true);
    } catch (e) {
      Alert.alert('Could not send feedback', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  const otherLang = article?.availableLanguages.find((l) => l !== article.language);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title={article?.category?.title ?? 'Help'} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : !article ? (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={36} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {offlineSince ? (
            <Text style={styles.offline}>
              Offline — saved copy from{' '}
              {new Date(offlineSince).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
            </Text>
          ) : null}
          <Text style={styles.title}>{article.title}</Text>
          <Text style={styles.summary}>{article.summary}</Text>
          {otherLang ? (
            <Pressable onPress={() => setLang(otherLang)} hitSlop={6}>
              <Text style={styles.langLink}>{otherLang === 'hi' ? 'हिंदी में पढ़ें' : 'Read in English'}</Text>
            </Pressable>
          ) : null}

          <View style={styles.body}>
            <HelpBlocks blocks={article.blocks} lang={article.language} />
          </View>

          {!offlineSince ? (
            <View style={styles.card}>
              {sent ? (
                <Text style={styles.cardText}>Thanks — your feedback helps us improve this article.</Text>
              ) : (
                <>
                  <Text style={styles.cardTitle}>Was this article helpful?</Text>
                  <View style={styles.voteRow}>
                    {[true, false].map((v) => (
                      <Pressable
                        key={String(v)}
                        disabled={sending}
                        onPress={() => sendFeedback(v, false)}
                        style={[styles.voteBtn, vote === v && styles.voteBtnActive]}
                        accessibilityRole="button"
                      >
                        <Ionicons
                          name={v ? 'thumbs-up-outline' : 'thumbs-down-outline'}
                          size={18}
                          color={vote === v ? colors.white : colors.primary}
                        />
                        <Text style={[styles.voteText, vote === v && styles.voteTextActive]}>{v ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {vote !== null ? (
                    <>
                      <TextInput
                        style={styles.input}
                        value={comment}
                        onChangeText={setComment}
                        placeholder={vote ? 'Anything we could add? (optional)' : 'What was missing or unclear? (optional)'}
                        placeholderTextColor={colors.textMuted}
                        multiline
                        maxLength={1000}
                        textAlignVertical="top"
                      />
                      <Pressable
                        disabled={sending || !comment.trim()}
                        onPress={() => sendFeedback(vote, true)}
                        style={[styles.sendBtn, (sending || !comment.trim()) && styles.disabled]}
                      >
                        <Text style={styles.sendText}>Send comment</Text>
                      </Pressable>
                    </>
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          {article.related.length ? (
            <View>
              <Text style={styles.sectionLabel}>RELATED</Text>
              <View style={styles.relatedCard}>
                {article.related.map((r, i) => (
                  <Pressable
                    key={r.slug}
                    onPress={() => router.push({ pathname: '/help-article', params: { slug: r.slug, lang: article.language } })}
                    style={[styles.row, i === article.related.length - 1 && styles.rowLast]}
                  >
                    <Text style={styles.rowTitle}>{r.title}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <Pressable style={styles.supportBtn} onPress={() => router.push('/support')}>
            <Ionicons name="chatbubbles-outline" size={18} color={colors.primary} />
            <Text style={styles.supportText}>Still need help? Raise a ticket</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  offline: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  title: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: colors.text },
  summary: { marginTop: spacing.xs, fontSize: font.size.md, color: colors.textMuted },
  langLink: { marginTop: spacing.sm, color: colors.primary, fontWeight: font.weight.semibold },
  body: { marginTop: spacing.lg },
  errorText: { color: colors.textMuted, textAlign: 'center', fontSize: font.size.md },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primary },
  retryText: { color: colors.white, fontWeight: font.weight.bold },
  card: {
    marginTop: spacing.xl,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadow.card,
  },
  cardTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  cardText: { fontSize: font.size.md, color: colors.text },
  voteRow: { flexDirection: 'row', gap: spacing.sm },
  voteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  voteBtnActive: { backgroundColor: colors.primary },
  voteText: { color: colors.primary, fontWeight: font.weight.semibold },
  voteTextActive: { color: colors.white },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: font.size.md,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  sendBtn: { alignSelf: 'flex-start', paddingHorizontal: spacing.lg, height: 44, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primary },
  sendText: { color: colors.white, fontWeight: font.weight.bold },
  disabled: { opacity: 0.5 },
  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  relatedCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowTitle: { flex: 1, fontSize: font.size.md, color: colors.text },
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
