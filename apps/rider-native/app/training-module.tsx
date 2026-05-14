/**
 * Training module viewer — read a module, then mark it complete.
 *
 * Reads the module `id` from route params, renders the title / summary and a
 * lightweight inline markdown-ish renderer for `contentBody` (no markdown
 * library: `# `/`## ` headings, `- ` bullets, blank-line paragraphs). A
 * "Mark as complete" button calls growth.completeModule and flips to a
 * success state. If the module ships a quiz, it's shown read-only for review.
 *
 * Wired to GET/POST /api/rider/training/[id].
 */
import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import {
  growth,
  type TrainingModuleDetail,
  type QuizQuestion,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

/** A parsed line of the lightweight content format. */
type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string };

/**
 * Tiny markdown-ish parser — no dependency. Lines beginning with `# ` / `## `
 * become headings, `- ` / `* ` become bullets, consecutive non-empty plain
 * lines coalesce into a paragraph, blank lines break paragraphs.
 */
function parseContent(body: string): Block[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'para', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'h2', text: line.slice(3).trim() });
    } else if (line.startsWith('# ')) {
      flush();
      blocks.push({ kind: 'h1', text: line.slice(2).trim() });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      flush();
      blocks.push({ kind: 'bullet', text: line.slice(2).trim() });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Defensively coerce the `quizQuestions` JSON into a typed array. */
function normalizeQuiz(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizQuestion[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as any).question === 'string' &&
      Array.isArray((item as any).options)
    ) {
      const options = (item as any).options.filter(
        (o: unknown) => typeof o === 'string'
      ) as string[];
      const answer =
        typeof (item as any).answer === 'number' ? (item as any).answer : undefined;
      out.push({ question: (item as any).question, options, answer });
    }
  }
  return out;
}

export default function TrainingModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const moduleId = typeof id === 'string' ? id : '';

  const [module, setModule] = useState<TrainingModuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  const load = useCallback(async () => {
    if (!moduleId) {
      setError('Missing module.');
      return;
    }
    setError(null);
    try {
      setModule(await growth.trainingModule(moduleId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this module.');
    }
  }, [moduleId]);

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

  async function onComplete() {
    if (completing || !moduleId) return;
    setCompleting(true);
    setError(null);
    try {
      await growth.completeModule(moduleId);
      setJustCompleted(true);
      setModule((m) =>
        m
          ? {
              ...m,
              progress: {
                completed: true,
                completedAt: new Date().toISOString(),
                quizScore: m.progress.quizScore,
              },
            }
          : m
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your progress.');
    } finally {
      setCompleting(false);
    }
  }

  const blocks = useMemo(
    () => (module ? parseContent(module.contentBody) : []),
    [module]
  );
  const quiz = useMemo(
    () => (module ? normalizeQuiz(module.quizQuestions) : []),
    [module]
  );
  const isComplete = module?.progress.completed ?? false;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {module?.title ?? 'Module'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !module ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textMuted} />
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
      ) : module ? (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {/* Title block */}
            <Text style={styles.title}>{module.title}</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaChipText}>{module.durationMin} min read</Text>
              </View>
              {module.isRequired ? (
                <View style={[styles.metaChip, styles.metaChipRequired]}>
                  <Text style={styles.metaChipRequiredText}>REQUIRED</Text>
                </View>
              ) : null}
              {isComplete ? (
                <View style={[styles.metaChip, styles.metaChipDone]}>
                  <Ionicons name="checkmark" size={13} color={colors.success} />
                  <Text style={styles.metaChipDoneText}>Completed</Text>
                </View>
              ) : null}
            </View>
            {module.summary ? (
              <Text style={styles.summary}>{module.summary}</Text>
            ) : null}

            {/* Content */}
            <View style={styles.contentCard}>
              {blocks.length === 0 ? (
                <Text style={styles.para}>No content for this module yet.</Text>
              ) : (
                blocks.map((b, i) => {
                  if (b.kind === 'h1') {
                    return (
                      <Text key={i} style={styles.h1}>
                        {b.text}
                      </Text>
                    );
                  }
                  if (b.kind === 'h2') {
                    return (
                      <Text key={i} style={styles.h2}>
                        {b.text}
                      </Text>
                    );
                  }
                  if (b.kind === 'bullet') {
                    return (
                      <View key={i} style={styles.bulletRow}>
                        <View style={styles.bulletDot} />
                        <Text style={styles.bulletText}>{b.text}</Text>
                      </View>
                    );
                  }
                  return (
                    <Text key={i} style={styles.para}>
                      {b.text}
                    </Text>
                  );
                })
              )}
            </View>

            {/* Optional quiz — shown read-only for review */}
            {quiz.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>QUICK QUIZ</Text>
                <View style={styles.contentCard}>
                  {quiz.map((q, qi) => (
                    <View
                      key={qi}
                      style={[
                        styles.quizBlock,
                        qi === quiz.length - 1 && styles.quizBlockLast,
                      ]}
                    >
                      <Text style={styles.quizQuestion}>
                        {qi + 1}. {q.question}
                      </Text>
                      {q.options.map((opt, oi) => {
                        const correct = q.answer === oi;
                        return (
                          <View key={oi} style={styles.quizOption}>
                            <Ionicons
                              name={
                                correct
                                  ? 'checkmark-circle'
                                  : 'ellipse-outline'
                              }
                              size={16}
                              color={correct ? colors.success : colors.textMuted}
                            />
                            <Text
                              style={[
                                styles.quizOptionText,
                                correct && styles.quizOptionTextCorrect,
                              ]}
                            >
                              {opt}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

            {/* Success state */}
            {justCompleted ? (
              <View style={styles.successCard}>
                <Ionicons
                  name="checkmark-circle"
                  size={36}
                  color={colors.success}
                />
                <Text style={styles.successTitle}>Module complete!</Text>
                <Text style={styles.successText}>
                  Nice work — your progress has been saved. Keep going to finish
                  your certification.
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer action */}
          <View style={styles.footer}>
            {isComplete && !justCompleted ? (
              <View style={styles.footerDone}>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={colors.success}
                />
                <Text style={styles.footerDoneText}>
                  You completed this module
                </Text>
              </View>
            ) : justCompleted ? (
              <Pressable
                style={[styles.completeBtn, styles.completeBtnGhost]}
                onPress={() => router.back()}
              >
                <Text style={styles.completeBtnGhostText}>Back to training</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.completeBtn}
                onPress={onComplete}
                disabled={completing}
              >
                {completing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-done"
                      size={20}
                      color={colors.white}
                    />
                    <Text style={styles.completeBtnText}>Mark as complete</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginHorizontal: spacing.sm,
  },
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

  title: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  metaChipText: { fontSize: font.size.xs, color: colors.textMuted },
  metaChipRequired: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoft,
  },
  metaChipRequiredText: {
    fontSize: 9,
    fontWeight: font.weight.bold,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  metaChipDone: {
    backgroundColor: colors.successSoft,
    borderColor: colors.successSoft,
  },
  metaChipDoneText: {
    fontSize: font.size.xs,
    color: colors.success,
    fontWeight: font.weight.semibold,
  },
  summary: {
    fontSize: font.size.md,
    color: colors.textMuted,
    lineHeight: 22,
    marginTop: spacing.md,
  },

  contentCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
    ...shadow.card,
  },
  h1: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  h2: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  para: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.xs,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 22,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  quizBlock: {
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  quizBlockLast: { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 },
  quizQuestion: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  quizOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  quizOptionText: {
    flex: 1,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
  quizOptionTextCorrect: {
    color: colors.text,
    fontWeight: font.weight.medium,
  },

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
    overflow: 'hidden',
  },

  successCard: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.success,
    padding: spacing.lg,
    marginTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  successTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.success,
    marginTop: spacing.xs,
  },
  successText: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
    textAlign: 'center',
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  completeBtnText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.md,
  },
  completeBtnGhost: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  completeBtnGhostText: {
    color: colors.primary,
    fontWeight: font.weight.bold,
    fontSize: font.size.md,
  },
  footerDone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  footerDoneText: {
    color: colors.success,
    fontWeight: font.weight.semibold,
    fontSize: font.size.md,
  },
});
