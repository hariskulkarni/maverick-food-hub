/**
 * Training module — lesson viewer → quiz → results / retake → certificate.
 *
 * Lessons are markdown (headings, lists, bold, links) plus optional image,
 * video link or checklist. The quiz is graded on the server; correct answers
 * are only revealed after a pass. Each lesson is marked done as the rider
 * moves through, and a pass issues the certificate for the module's current
 * version.
 *
 * Offline-friendly: the last copy of each opened module is cached on the
 * device, so lessons can be read without a network (saving progress and taking
 * the quiz need a connection).
 *
 * Wired to GET /api/rider/training/[id], POST …/lessons/[lessonId], POST …/quiz.
 */
import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { TrainingMarkdown } from '../components/training-markdown';
import { growth, type TrainingModuleDetail, type TrainingLesson, type QuizResult, type TrainingLang } from '../lib/api-growth';
import { cacheKeys, getTrainingLang, readCache, savedAgo, writeCache } from '../lib/training-cache';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

function firstOpenStep(m: TrainingModuleDetail): number {
  const lessons = m.lessons ?? [];
  const done = new Set(m.completedLessonIds ?? []);
  const idx = lessons.findIndex((l) => !done.has(l.id));
  if (idx >= 0) return idx;
  return m.quiz && m.status?.state !== 'CERTIFIED' ? lessons.length : 0;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function TrainingModuleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const moduleId = typeof id === 'string' ? id : '';

  const [lang, setLang] = useState<TrainingLang>('en');
  const [mod, setMod] = useState<TrainingModuleDetail | null>(null);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const apply = useCallback((m: TrainingModuleDetail, l: TrainingLang) => {
    setMod(m);
    writeCache(cacheKeys.module(m.id, l), m);
  }, []);

  const load = useCallback(
    async (l: TrainingLang, resetStep: boolean) => {
      if (!moduleId) {
        setError('Missing module.');
        return;
      }
      setError(null);
      try {
        const fresh = await growth.trainingModule(moduleId, l);
        apply(fresh, l);
        setOfflineSince(null);
        if (resetStep) setStep(firstOpenStep(fresh));
      } catch (e) {
        const cached = await readCache<TrainingModuleDetail>(cacheKeys.module(moduleId, l));
        if (cached) {
          setMod(cached.data);
          setOfflineSince(cached.savedAt);
          if (resetStep) setStep(firstOpenStep(cached.data));
        } else {
          setError(e instanceof ApiError ? e.message : 'Could not load this module.');
        }
      }
    },
    [moduleId, apply]
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const l = await getTrainingLang();
        if (cancelled) return;
        setLang(l);
        await load(l, true);
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const lessons = useMemo(() => mod?.lessons ?? [], [mod]);
  const done = useMemo(() => new Set(mod?.completedLessonIds ?? []), [mod]);
  const quiz = mod?.quiz ?? null;
  const certified = mod?.status?.state === 'CERTIFIED' || (!mod?.status && !!mod?.progress.completed);
  const onQuiz = !!quiz && step >= lessons.length;
  const lesson: TrainingLesson | null = onQuiz ? null : lessons[step] ?? null;

  async function markDone() {
    if (!mod || !lesson || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const { module: fresh } = await growth.completeLesson(mod.id, lesson.id, lang);
      apply(fresh, lang);
      if (step + 1 < lessons.length || fresh.quiz) setStep(step + 1);
    } catch (e) {
      setActionError(e instanceof ApiError && e.status !== 0 ? e.message : 'You need a connection to save progress. You can keep reading offline.');
    } finally {
      setBusy(false);
    }
  }

  async function submitQuiz() {
    if (!mod || !quiz || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await growth.submitQuiz(mod.id, answers, lang);
      setResult(res.result);
      apply(res.module, lang);
    } catch (e) {
      setActionError(e instanceof ApiError && e.status !== 0 ? e.message : 'You need a connection to submit the quiz.');
      await load(lang, false);
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    setResult(null);
    setAnswers({});
    setActionError(null);
    load(lang, false);
  }

  // Pre-v2 server (no lessons array): keep the old single-page completion working.
  async function legacyComplete() {
    if (!mod || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await growth.completeModule(mod.id);
      await load(lang, false);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not save your progress.');
    } finally {
      setBusy(false);
    }
  }

  const elig = quiz?.eligibility;
  const allAnswered = !!quiz && quiz.questions.every((q) => answers[q.id] !== undefined);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title={mod?.title ?? 'Module'} />

      {loading && !mod ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error && !mod ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); load(lang, true).then(() => setLoading(false)); }}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : mod ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {offlineSince ? (
            <View style={styles.offline}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.textMuted} />
              <Text style={styles.offlineText}>Offline copy saved {savedAgo(offlineSince)}. Reading works; saving needs a connection.</Text>
            </View>
          ) : null}

          <Text style={styles.title}>{mod.title}</Text>
          <View style={styles.metaRow}>
            <Chip icon="time-outline" text={`${mod.durationMin} min`} />
            {mod.isRequired ? <Chip text="REQUIRED" tone="primary" /> : null}
            {mod.status?.needsRecert ? <Chip text="RE-CERTIFY" tone="danger" /> : null}
            {mod.status?.overdue && !certified ? <Chip text="OVERDUE" tone="danger" /> : null}
            {certified ? <Chip icon="checkmark" text="Certified" tone="success" /> : null}
          </View>
          {mod.summary ? <Text style={styles.summary}>{mod.summary}</Text> : null}

          {mod.status ? (
            <View style={styles.bar}><View style={[styles.barFill, { width: `${mod.status.progressPct}%` }]} /></View>
          ) : null}

          {certified && mod.status?.certificateCode ? (
            <View style={styles.certCard}>
              <Ionicons name="ribbon" size={28} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.certTitle}>Flavrly certificate</Text>
                <Text style={styles.certMeta}>
                  {mod.status.certificateCode} · version {mod.version ?? 1}
                  {mod.progress.completedAt ? ` · ${fmtDate(mod.progress.completedAt)}` : ''}
                </Text>
              </View>
            </View>
          ) : null}

          {!mod.lessons ? (
            <View style={styles.card}>
              <TrainingMarkdown source={mod.contentBody} />
              {!certified ? (
                <Pressable style={styles.primaryBtn} onPress={legacyComplete} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Mark complete</Text>}
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.steps}>
                {lessons.map((l, i) => (
                  <Pressable key={l.id} onPress={() => { setStep(i); setResult(null); }} style={[styles.stepChip, step === i && styles.stepChipOn]}>
                    <Ionicons
                      name={done.has(l.id) ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={done.has(l.id) ? colors.success : step === i ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.stepText, step === i && styles.stepTextOn]}>{i + 1}</Text>
                  </Pressable>
                ))}
                {quiz ? (
                  <Pressable onPress={() => setStep(lessons.length)} style={[styles.stepChip, onQuiz && styles.stepChipOn]}>
                    <Ionicons name={certified ? 'checkmark-circle' : 'help-circle-outline'} size={14} color={certified ? colors.success : onQuiz ? colors.primary : colors.textMuted} />
                    <Text style={[styles.stepText, onQuiz && styles.stepTextOn]}>Quiz</Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              {lesson ? (
                <View style={styles.card}>
                  <Text style={styles.stepLabel}>LESSON {step + 1} OF {lessons.length}</Text>
                  <Text style={styles.lessonTitle}>{lesson.title}</Text>
                  {lesson.kind === 'IMAGE' && lesson.mediaUrl ? (
                    <Image source={{ uri: lesson.mediaUrl }} style={styles.media} resizeMode="cover" accessibilityLabel={lesson.title} />
                  ) : null}
                  {lesson.kind === 'VIDEO' && lesson.mediaUrl ? (
                    <Pressable style={styles.videoBtn} onPress={() => WebBrowser.openBrowserAsync(lesson.mediaUrl!).catch(() => {})}>
                      <Ionicons name="play-circle" size={28} color={colors.primary} />
                      <Text style={styles.videoText}>Watch the video</Text>
                      <Ionicons name="open-outline" size={16} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                  {lesson.body.trim() ? <TrainingMarkdown source={lesson.body} /> : null}
                  {lesson.kind === 'CHECKLIST' && lesson.checklistItems.length ? <Checklist key={lesson.id} items={lesson.checklistItems} /> : null}

                  {done.has(lesson.id) ? (
                    <View style={styles.doneRow}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                      <Text style={styles.doneText}>Done</Text>
                      {step + 1 < lessons.length || quiz ? (
                        <Pressable style={styles.secondaryBtn} onPress={() => setStep(step + 1)}>
                          <Text style={styles.secondaryBtnText}>Next</Text>
                          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                        </Pressable>
                      ) : null}
                    </View>
                  ) : (
                    <Pressable style={styles.primaryBtn} onPress={markDone} disabled={busy}>
                      {busy ? (
                        <ActivityIndicator color={colors.white} />
                      ) : (
                        <Text style={styles.primaryBtnText}>
                          {step + 1 < lessons.length ? 'Mark done and continue' : quiz ? 'Mark done and take the quiz' : 'Finish module'}
                        </Text>
                      )}
                    </Pressable>
                  )}
                </View>
              ) : null}

              {onQuiz && quiz ? (
                <View style={styles.card}>
                  <Text style={styles.lessonTitle}>Quiz</Text>
                  <Text style={styles.quizMeta}>
                    Pass mark {quiz.passMarkPct}%{quiz.maxAttempts ? ` · ${elig?.attemptsLeft ?? 0} of ${quiz.maxAttempts} attempts left` : ''}
                  </Text>

                  {result ? (
                    <Results quiz={quiz} result={result} answers={answers} onRetake={retake} />
                  ) : certified || elig?.reason === 'already_passed' ? (
                    <Notice tone="success" text={`You passed this quiz${quiz.lastAttempt ? ` with ${quiz.lastAttempt.scorePct}%` : ''}.`} />
                  ) : elig && !elig.allowed ? (
                    <Notice
                      tone="warning"
                      text={
                        elig.reason === 'lessons_incomplete'
                          ? 'Finish every lesson to unlock the quiz.'
                          : elig.reason === 'cooldown'
                            ? `You can try again at ${elig.retryAt ? fmtTime(elig.retryAt) : 'a little later'}. Review the lessons meanwhile.`
                            : 'You have used all your attempts. Contact Flavrly Support from the Support screen to reset them.'
                      }
                    />
                  ) : (
                    <>
                      {quiz.questions.map((q, qi) => (
                        <View key={q.id} style={styles.question}>
                          <Text style={styles.questionText}>{qi + 1}. {q.prompt}</Text>
                          {q.options.map((opt, oi) => {
                            const on = answers[q.id] === oi;
                            return (
                              <Pressable
                                key={oi}
                                onPress={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                                style={[styles.option, on && styles.optionOn]}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: on }}
                              >
                                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? colors.primary : colors.textMuted} />
                                <Text style={styles.optionText}>{opt}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ))}
                      <Pressable style={[styles.primaryBtn, !allAnswered && styles.btnDisabled]} onPress={submitQuiz} disabled={!allAnswered || busy}>
                        {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Submit answers</Text>}
                      </Pressable>
                    </>
                  )}
                </View>
              ) : null}
            </>
          )}

          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function Chip({ text, icon, tone }: { text: string; icon?: keyof typeof Ionicons.glyphMap; tone?: 'primary' | 'success' | 'danger' }) {
  const c = tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.textMuted;
  const bg = tone === 'primary' ? colors.primarySoft : tone === 'success' ? colors.successSoft : tone === 'danger' ? colors.dangerSoft : colors.card;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={13} color={c} /> : null}
      <Text style={[styles.chipText, { color: c }]}>{text}</Text>
    </View>
  );
}

function Notice({ tone, text }: { tone: 'success' | 'warning'; text: string }) {
  return (
    <View style={[styles.notice, tone === 'success' ? { backgroundColor: colors.successSoft, borderColor: colors.success } : { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function Checklist({ items }: { items: string[] }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  return (
    <View style={styles.checklist}>
      {items.map((it, i) => {
        const on = ticked.has(i);
        return (
          <Pressable
            key={i}
            style={styles.checkRow}
            onPress={() => setTicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
          >
            <View style={[styles.checkBox, on && styles.checkBoxOn]}>{on ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}</View>
            <Text style={[styles.checkText, on && styles.checkTextDone]}>{it}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Results({ quiz, result, answers, onRetake }: { quiz: NonNullable<TrainingModuleDetail['quiz']>; result: QuizResult; answers: Record<string, number>; onRetake: () => void }) {
  const byId = new Map(result.questions.map((q) => [q.questionId, q]));
  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.resultBanner, result.passed ? { backgroundColor: colors.successSoft, borderColor: colors.success } : { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}>
        <Ionicons name={result.passed ? 'ribbon' : 'close-circle'} size={30} color={result.passed ? colors.success : colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={styles.resultTitle}>{result.passed ? 'You passed! Certificate issued.' : 'Not passed this time'}</Text>
          <Text style={styles.resultMeta}>{result.correctCount}/{result.totalCount} correct · {result.scorePct}% (pass mark {result.passMarkPct}%)</Text>
        </View>
      </View>
      {quiz.questions.map((q, i) => {
        const r = byId.get(q.id);
        return (
          <View key={q.id} style={styles.resultRow}>
            <Ionicons name={r?.correct ? 'checkmark-circle' : 'close-circle'} size={18} color={r?.correct ? colors.success : colors.danger} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.resultQ}>{i + 1}. {q.prompt}</Text>
              <Text style={styles.resultA}>Your answer: {answers[q.id] !== undefined ? q.options[answers[q.id]] : 'No answer'}</Text>
              {r && r.correctIndex !== null && !r.correct ? <Text style={[styles.resultA, { color: colors.success }]}>Correct: {q.options[r.correctIndex]}</Text> : null}
              {r?.explanation ? <Text style={styles.resultExp}>{r.explanation}</Text> : null}
            </View>
          </View>
        );
      })}
      {!result.passed ? (
        <Pressable style={styles.secondaryBtnWide} onPress={onRetake}>
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <Text style={styles.secondaryBtnText}>Review lessons and retake</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  errorText: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  retryBtnText: { color: colors.primary, fontWeight: font.weight.semibold, fontSize: font.size.sm },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.md },
  offline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm },
  offlineText: { flex: 1, fontSize: font.size.xs, color: colors.textMuted },
  title: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: colors.text },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: font.size.xs, fontWeight: font.weight.semibold },
  summary: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.primary },
  certCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.successSoft, borderRadius: radius.md, borderWidth: 1, borderColor: colors.success, padding: spacing.md },
  certTitle: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  certMeta: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
  steps: { gap: spacing.xs, paddingVertical: 2 },
  stepChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, minHeight: 36 },
  stepChipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  stepText: { fontSize: font.size.sm, color: colors.textMuted, fontWeight: font.weight.semibold },
  stepTextOn: { color: colors.primary },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md, ...shadow.card },
  stepLabel: { fontSize: font.size.xs, fontWeight: font.weight.bold, color: colors.textMuted, letterSpacing: 1 },
  lessonTitle: { fontSize: font.size.lg, fontWeight: font.weight.bold, color: colors.text },
  media: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, backgroundColor: colors.border },
  videoBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  videoText: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  checklist: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minHeight: 32 },
  checkBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkBoxOn: { backgroundColor: colors.success, borderColor: colors.success },
  checkText: { flex: 1, fontSize: font.size.md, lineHeight: 22, color: colors.text },
  checkTextDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  primaryBtnText: { color: colors.white, fontWeight: font.weight.bold, fontSize: font.size.md },
  btnDisabled: { opacity: 0.5 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  doneText: { flex: 1, fontSize: font.size.sm, color: colors.success, fontWeight: font.weight.semibold },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  secondaryBtnWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, minHeight: 48 },
  secondaryBtnText: { color: colors.primary, fontWeight: font.weight.semibold, fontSize: font.size.sm },
  quizMeta: { fontSize: font.size.xs, color: colors.textMuted, marginTop: -spacing.sm },
  question: { gap: spacing.sm },
  questionText: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text, lineHeight: 22 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 48 },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { flex: 1, fontSize: font.size.sm, color: colors.text, lineHeight: 20 },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  noticeText: { fontSize: font.size.sm, color: colors.text, lineHeight: 20 },
  resultBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  resultTitle: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  resultMeta: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
  resultRow: { flexDirection: 'row', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  resultQ: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.text },
  resultA: { fontSize: font.size.xs, color: colors.textMuted },
  resultExp: { fontSize: font.size.xs, color: colors.text, lineHeight: 17 },
  actionError: { fontSize: font.size.sm, color: colors.danger, textAlign: 'center' },
});
