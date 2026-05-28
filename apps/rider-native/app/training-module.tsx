/**
 * Training module viewer — read a (block-based) lesson, take inline quiz
 * checks, then mark it complete.
 *
 * The lesson is rendered from the new `contentBlocks` array (heading,
 * paragraph, image, callout, checklist, key-points, divider, quiz). When the
 * module doesn't ship contentBlocks (older builds / legacy seed), we fall back
 * to the previous lightweight markdown-ish renderer over `contentBody`.
 *
 * Quiz interactivity: each quiz block is a single-question check. The total
 * score is sent up with the "complete" call as `quizScore` (0–100).
 *
 * Wired to GET/POST /api/rider/training/[id].
 */
import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import {
  growth,
  type TrainingModuleDetail,
  type QuizQuestion,
  type ContentBlock,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

// ─── Legacy markdown-ish parser (fallback for modules without contentBlocks) ──
type LegacyBlock =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string };

function parseLegacy(body: string): LegacyBlock[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out: LegacyBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) { out.push({ kind: 'para', text: para.join(' ').trim() }); para = []; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## '))      { flush(); out.push({ kind: 'h2', text: line.slice(3).trim() }); }
    else if (line.startsWith('# ')) { flush(); out.push({ kind: 'h1', text: line.slice(2).trim() }); }
    else if (line.startsWith('- ') || line.startsWith('* ')) { flush(); out.push({ kind: 'bullet', text: line.slice(2).trim() }); }
    else para.push(line);
  }
  flush();
  return out;
}

function normalizeQuiz(raw: unknown): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizQuestion[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as any).question === 'string' && Array.isArray((item as any).options)) {
      const options = (item as any).options.filter((o: unknown) => typeof o === 'string') as string[];
      const answer = typeof (item as any).answer === 'number' ? (item as any).answer : undefined;
      out.push({ question: (item as any).question, options, answer });
    }
  }
  return out;
}

const CALLOUT_COLOURS: Record<string, { bg: string; border: string; icon: any; iconColour: string }> = {
  tip:     { bg: colors.primarySoft, border: colors.primary, icon: 'bulb-outline',              iconColour: colors.primary },
  warning: { bg: colors.warningSoft, border: colors.warning, icon: 'alert-circle-outline',      iconColour: colors.warning },
  success: { bg: colors.successSoft, border: colors.success, icon: 'checkmark-circle-outline', iconColour: colors.success },
  danger:  { bg: colors.dangerSoft,  border: colors.danger,  icon: 'close-circle-outline',     iconColour: colors.danger },
  info:    { bg: colors.card,        border: colors.border,  icon: 'information-circle-outline', iconColour: colors.textMuted },
};

export default function TrainingModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const moduleId = typeof id === 'string' ? id : '';

  const [mod, setMod] = useState<TrainingModuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, Set<number>>>({});

  const load = useCallback(async () => {
    if (!moduleId) { setError('Missing module.'); return; }
    setError(null);
    try { setMod(await growth.trainingModule(moduleId)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load this module.'); }
  }, [moduleId]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => { await load(); if (!cancelled) setLoading(false); })();
    return () => { cancelled = true; };
  }, [load]));

  const blocks: ContentBlock[] = useMemo(() => mod?.contentBlocks ?? [], [mod]);
  const legacyBlocks = useMemo(() => (mod && blocks.length === 0 ? parseLegacy(mod.contentBody) : []), [mod, blocks]);
  const legacyQuiz = useMemo(() => (mod ? normalizeQuiz(mod.quizQuestions) : []), [mod]);

  const quizBlocks = useMemo(() => blocks.filter((b) => b.type === 'quiz') as Extract<ContentBlock, { type: 'quiz' }>[], [blocks]);
  const answeredCount = quizBlocks.filter((q) => quizAnswers[q.id] !== undefined).length;
  const correctCount = quizBlocks.filter((q) => quizAnswers[q.id] === q.correct).length;
  const quizScorePct = quizBlocks.length > 0 ? Math.round((correctCount / quizBlocks.length) * 100) : null;

  const isComplete = mod?.progress.completed ?? false;
  const canComplete = quizBlocks.length === 0 || answeredCount === quizBlocks.length;

  async function onComplete() {
    if (completing || !moduleId) return;
    setCompleting(true);
    setError(null);
    try {
      await growth.completeModule(moduleId, quizScorePct ?? undefined);
      setJustCompleted(true);
      setMod((m) => m ? { ...m, progress: { completed: true, completedAt: new Date().toISOString(), quizScore: quizScorePct ?? m.progress.quizScore } } : m);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your progress.');
    } finally {
      setCompleting(false);
    }
  }

  function toggleCheck(blockId: string, idx: number) {
    setChecked((c) => {
      const set = new Set(c[blockId] ?? []);
      if (set.has(idx)) set.delete(idx); else set.add(idx);
      return { ...c, [blockId]: set };
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title={mod?.title ?? 'Module'} />

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error && !mod ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); load().then(() => setLoading(false)); }}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : mod ? (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {mod.heroImageUrl ? (
              <Image source={{ uri: mod.heroImageUrl }} style={styles.hero} resizeMode="cover" />
            ) : null}

            <Text style={styles.title}>{mod.title}</Text>
            <View style={styles.metaRow}>
              <View style={styles.metaChip}>
                <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                <Text style={styles.metaChipText}>{mod.durationMin} min</Text>
              </View>
              {mod.isRequired ? (
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
              {quizBlocks.length > 0 ? (
                <View style={styles.metaChip}>
                  <Ionicons name="help-circle-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.metaChipText}>{answeredCount}/{quizBlocks.length} quiz</Text>
                </View>
              ) : null}
            </View>
            {mod.summary ? <Text style={styles.summary}>{mod.summary}</Text> : null}

            {/* ── Block-based lesson body ───────────────────────────────────── */}
            {blocks.length > 0 ? (
              <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                {blocks.map((b) => {
                  switch (b.type) {
                    case 'heading':
                      return <Text key={b.id} style={styles.h1}>{b.text}</Text>;
                    case 'paragraph':
                      return <Text key={b.id} style={styles.para}>{b.text}</Text>;
                    case 'image':
                      return (
                        <View key={b.id} style={{ marginVertical: spacing.xs }}>
                          <Image source={{ uri: b.src }} style={styles.blockImage} resizeMode="cover" />
                          {b.caption ? <Text style={styles.caption}>{b.caption}</Text> : null}
                        </View>
                      );
                    case 'callout': {
                      const cs = CALLOUT_COLOURS[b.tone] ?? CALLOUT_COLOURS.info;
                      return (
                        <View key={b.id} style={[styles.callout, { backgroundColor: cs.bg, borderColor: cs.border }]}>
                          <Ionicons name={cs.icon} size={20} color={cs.iconColour} />
                          <View style={{ flex: 1 }}>
                            {b.title ? <Text style={[styles.calloutTitle, { color: cs.iconColour }]}>{b.title}</Text> : null}
                            <Text style={styles.calloutBody}>{b.body}</Text>
                          </View>
                        </View>
                      );
                    }
                    case 'checklist': {
                      const set = checked[b.id] ?? new Set<number>();
                      return (
                        <View key={b.id} style={styles.contentCard}>
                          {b.title ? <Text style={styles.h2}>{b.title}</Text> : null}
                          {b.items.map((it, i) => {
                            const on = set.has(i);
                            return (
                              <Pressable key={i} style={styles.checkRow} onPress={() => toggleCheck(b.id, i)}>
                                <View style={[styles.checkBox, on && styles.checkBoxOn]}>
                                  {on ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
                                </View>
                                <Text style={[styles.checkText, on && styles.checkTextDone]}>{it}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    }
                    case 'keyPoints':
                      return (
                        <View key={b.id} style={styles.contentCard}>
                          {b.title ? <Text style={styles.sectionLabelInline}>{b.title}</Text> : null}
                          {b.points.map((p, i) => (
                            <View key={i} style={styles.bulletRow}>
                              <View style={styles.bulletDot} />
                              <Text style={styles.bulletText}>{p}</Text>
                            </View>
                          ))}
                        </View>
                      );
                    case 'divider':
                      return <View key={b.id} style={styles.divider} />;
                    case 'quiz': {
                      const ans = quizAnswers[b.id];
                      const answered = ans !== undefined;
                      const correct = ans === b.correct;
                      return (
                        <View key={b.id} style={styles.quizCard}>
                          <Text style={styles.sectionLabelInline}>QUICK CHECK</Text>
                          <Text style={styles.quizQuestion}>{b.question}</Text>
                          {b.options.map((opt, i) => {
                            const isChoice = ans === i;
                            const isCorrect = i === b.correct;
                            const tone =
                              answered && isChoice && isCorrect ? 'right' :
                              answered && isChoice ? 'wrong' :
                              answered && isCorrect ? 'reveal' : isChoice ? 'picked' : 'idle';
                            return (
                              <Pressable
                                key={i}
                                onPress={() => !answered && setQuizAnswers((q) => ({ ...q, [b.id]: i }))}
                                style={[
                                  styles.quizOption,
                                  tone === 'right' && styles.quizOptionRight,
                                  tone === 'wrong' && styles.quizOptionWrong,
                                  tone === 'reveal' && styles.quizOptionReveal,
                                  tone === 'picked' && styles.quizOptionPicked,
                                ]}
                                disabled={answered}
                              >
                                <View style={styles.quizLetter}>
                                  <Text style={styles.quizLetterText}>{tone === 'right' || tone === 'reveal' ? '✓' : tone === 'wrong' ? '✕' : String.fromCharCode(65 + i)}</Text>
                                </View>
                                <Text style={styles.quizOptionText}>{opt}</Text>
                              </Pressable>
                            );
                          })}
                          {answered && b.explanation ? (
                            <View style={[styles.callout, correct ? { backgroundColor: colors.successSoft, borderColor: colors.success } : { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
                              <Ionicons name={correct ? 'checkmark-circle' : 'alert-circle'} size={20} color={correct ? colors.success : colors.warning} />
                              <Text style={[styles.calloutBody, { flex: 1 }]}>{b.explanation}</Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    }
                  }
                })}
              </View>
            ) : (
              <View style={styles.contentCard}>
                {legacyBlocks.length === 0 ? (
                  <Text style={styles.para}>No content for this module yet.</Text>
                ) : legacyBlocks.map((b, i) => {
                  if (b.kind === 'h1') return <Text key={i} style={styles.h1}>{b.text}</Text>;
                  if (b.kind === 'h2') return <Text key={i} style={styles.h2}>{b.text}</Text>;
                  if (b.kind === 'bullet') return (
                    <View key={i} style={styles.bulletRow}>
                      <View style={styles.bulletDot} />
                      <Text style={styles.bulletText}>{b.text}</Text>
                    </View>
                  );
                  return <Text key={i} style={styles.para}>{b.text}</Text>;
                })}
              </View>
            )}

            {/* Legacy quiz (for modules with quizQuestions JSON but no quiz blocks) */}
            {legacyQuiz.length > 0 && quizBlocks.length === 0 ? (
              <>
                <Text style={styles.sectionLabel}>QUICK QUIZ</Text>
                <View style={styles.contentCard}>
                  {legacyQuiz.map((q, qi) => (
                    <View key={qi} style={[styles.quizBlock, qi === legacyQuiz.length - 1 && styles.quizBlockLast]}>
                      <Text style={styles.quizQuestion}>{qi + 1}. {q.question}</Text>
                      {q.options.map((opt, oi) => {
                        const correct = q.answer === oi;
                        return (
                          <View key={oi} style={styles.quizOptionLegacy}>
                            <Ionicons name={correct ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={correct ? colors.success : colors.textMuted} />
                            <Text style={[styles.quizOptionTextLegacy, correct && styles.quizOptionTextCorrect]}>{opt}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

            {justCompleted ? (
              <View style={styles.successCard}>
                <Ionicons name="checkmark-circle" size={36} color={colors.success} />
                <Text style={styles.successTitle}>Module complete!</Text>
                <Text style={styles.successText}>
                  Nice work — your progress has been saved.{quizScorePct !== null ? ` You scored ${quizScorePct}% on the quiz.` : ''}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {isComplete && !justCompleted ? (
              <View style={styles.footerDone}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.footerDoneText}>You completed this module</Text>
              </View>
            ) : justCompleted ? (
              <Pressable style={[styles.completeBtn, styles.completeBtnGhost]} onPress={() => router.back()}>
                <Text style={styles.completeBtnGhostText}>Back to training</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.completeBtn, !canComplete && { opacity: 0.5 }]}
                onPress={onComplete}
                disabled={completing || !canComplete}
              >
                {completing ? <ActivityIndicator color={colors.white} /> : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color={colors.white} />
                    <Text style={styles.completeBtnText}>
                      {canComplete ? 'Mark as complete' : `Answer ${quizBlocks.length - answeredCount} more`}
                    </Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  errorText: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  retryBtnText: { color: colors.primary, fontWeight: font.weight.semibold, fontSize: font.size.sm },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },

  hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, marginBottom: spacing.md, backgroundColor: colors.card },
  title: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  metaChipText: { fontSize: font.size.xs, color: colors.textMuted },
  metaChipRequired: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  metaChipRequiredText: { fontSize: 9, fontWeight: font.weight.bold, color: colors.primary, letterSpacing: 0.5 },
  metaChipDone: { backgroundColor: colors.successSoft, borderColor: colors.successSoft },
  metaChipDoneText: { fontSize: font.size.xs, color: colors.success, fontWeight: font.weight.semibold },
  summary: { fontSize: font.size.md, color: colors.textMuted, lineHeight: 22, marginTop: spacing.md },

  contentCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadow.card },
  h1: { fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.text, marginTop: spacing.sm },
  h2: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text, marginBottom: spacing.xs },
  para: { fontSize: font.size.sm, color: colors.text, lineHeight: 22 },

  blockImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.card },
  caption: { fontSize: font.size.xs, color: colors.textMuted, marginTop: spacing.xs },

  callout: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radius.lg },
  calloutTitle: { fontSize: font.size.sm, fontWeight: font.weight.bold, marginBottom: 2 },
  calloutBody: { fontSize: font.size.sm, color: colors.text, lineHeight: 20 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 6 },
  checkBox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.border, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { backgroundColor: colors.success, borderColor: colors.success },
  checkText: { flex: 1, fontSize: font.size.sm, color: colors.text, lineHeight: 20 },
  checkTextDone: { color: colors.textMuted, textDecorationLine: 'line-through' },

  bulletRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4, paddingLeft: spacing.xs },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 9 },
  bulletText: { flex: 1, fontSize: font.size.sm, color: colors.text, lineHeight: 22 },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, fontSize: font.size.xs, fontWeight: font.weight.bold, color: colors.textMuted, letterSpacing: 1.2 },
  sectionLabelInline: { fontSize: font.size.xs, fontWeight: font.weight.bold, color: colors.primary, letterSpacing: 1.2, marginBottom: spacing.sm },

  quizCard: { backgroundColor: colors.primarySoft, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, padding: spacing.lg, gap: spacing.sm },
  quizQuestion: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text, lineHeight: 22, marginBottom: spacing.xs },
  quizOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderWidth: 2, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.bg },
  quizOptionPicked: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  quizOptionRight: { borderColor: colors.success, backgroundColor: colors.successSoft },
  quizOptionWrong: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  quizOptionReveal: { borderColor: colors.success },
  quizLetter: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  quizLetterText: { fontSize: font.size.xs, fontWeight: font.weight.bold, color: colors.text },
  quizOptionText: { flex: 1, fontSize: font.size.sm, color: colors.text, lineHeight: 20 },

  // Legacy quiz styles (for modules without contentBlocks)
  quizBlock: { paddingBottom: spacing.md, marginBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  quizBlockLast: { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 },
  quizOptionLegacy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  quizOptionTextLegacy: { flex: 1, fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
  quizOptionTextCorrect: { color: colors.text, fontWeight: font.weight.medium },

  errorBanner: { backgroundColor: colors.dangerSoft, color: colors.danger, fontSize: font.size.sm, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md, overflow: 'hidden' },

  successCard: { backgroundColor: colors.successSoft, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.success, padding: spacing.lg, marginTop: spacing.lg, alignItems: 'center', gap: spacing.xs },
  successTitle: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.success, marginTop: spacing.xs },
  successText: { fontSize: font.size.sm, color: colors.text, lineHeight: 20, textAlign: 'center' },

  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  completeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 54, borderRadius: radius.md, backgroundColor: colors.primary },
  completeBtnText: { color: colors.white, fontWeight: font.weight.bold, fontSize: font.size.md },
  completeBtnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  completeBtnGhostText: { color: colors.primary, fontWeight: font.weight.bold, fontSize: font.size.md },
  footerDone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 54, borderRadius: radius.md, backgroundColor: colors.successSoft },
  footerDoneText: { color: colors.success, fontWeight: font.weight.semibold, fontSize: font.size.md },
});
