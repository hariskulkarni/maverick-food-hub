/**
 * Help & Support — raise a ticket, track existing ones, browse the FAQ.
 *
 * A "Raise a ticket" form (subject + category chips + message), the rider's
 * ticket list with status chips and last-message previews (tap → thread), and
 * a small static FAQ accordion for the most common rider questions.
 *
 * Wired to GET/POST /api/rider/support.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
  TextInput,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import {
  growth,
  type SupportTicketsResponse,
  type TicketSummary,
  type TicketCategory,
  type TicketStatus,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'APP_BUG', label: 'App bug' },
  { value: 'ORDER_ISSUE', label: 'Order issue' },
  { value: 'KYC', label: 'KYC' },
  { value: 'ACCOUNT', label: 'Account' },
  { value: 'SAFETY', label: 'Safety' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_STYLE: Record<TicketStatus, { bg: string; fg: string; label: string }> = {
  OPEN: { bg: colors.primarySoft, fg: colors.primary, label: 'Open' },
  IN_PROGRESS: { bg: '#fdf4e3', fg: colors.warning, label: 'In progress' },
  WAITING_ON_RIDER: { bg: '#fdf4e3', fg: colors.warning, label: 'Needs your reply' },
  RESOLVED: { bg: colors.successSoft, fg: colors.success, label: 'Resolved' },
  CLOSED: { bg: colors.bg, fg: colors.textMuted, label: 'Closed' },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'When do I get paid for my deliveries?',
    a: 'Earnings are tallied daily and paid out to your registered bank account on a weekly cycle. Check the Payouts screen for your next payout date.',
  },
  {
    q: 'A customer was not at the delivery address — what do I do?',
    a: 'Use the "Customer unreachable" action on the active delivery. Wait at the location for the prompted time, then the order can be returned. You are still paid for the trip.',
  },
  {
    q: 'How is my rating calculated?',
    a: 'Your rating is the average of customer delivery ratings over your recent orders. On-time delivery and careful handling keep it high.',
  },
  {
    q: 'My KYC document was rejected. How do I re-upload?',
    a: 'Open Profile to see the rejection reason, then re-upload the corrected document from the web rider portal. Verification usually completes within 24 hours.',
  },
  {
    q: 'How do I go online to receive orders?',
    a: 'Toggle yourself online from the Home tab. Make sure location permission is granted so the dispatcher can match you with nearby orders.',
  },
];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function SupportScreen() {
  const [data, setData] = useState<SupportTicketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('OTHER');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await growth.supportTickets());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your tickets.');
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

  async function onSubmit() {
    if (submitting) return;
    const s = subject.trim();
    const m = message.trim();
    if (!s) {
      Alert.alert('Subject needed', 'Add a short subject for your ticket.');
      return;
    }
    if (!m) {
      Alert.alert('Describe the issue', 'Tell us what went wrong so we can help.');
      return;
    }
    setSubmitting(true);
    try {
      await growth.createTicket(s, category, m);
      setSubject('');
      setMessage('');
      setCategory('OTHER');
      setShowForm(false);
      await load();
    } catch (e) {
      Alert.alert(
        'Could not raise ticket',
        e instanceof ApiError ? e.message : 'Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFaq(i: number) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenFaq((cur) => (cur === i ? null : i));
  }

  const tickets = data?.tickets ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Help & Support</Text>
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
          keyboardShouldPersistTaps="handled"
        >
          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          {/* Raise a ticket */}
          {showForm ? (
            <View style={styles.card}>
              <View style={styles.formPad}>
                <Text style={styles.formTitle}>Raise a ticket</Text>
                <Text style={styles.inputLabel}>Subject</Text>
                <TextInput
                  style={styles.input}
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="Short summary of your issue"
                  placeholderTextColor={colors.textMuted}
                  maxLength={200}
                />
                <Text style={[styles.inputLabel, { marginTop: spacing.md }]}>
                  Category
                </Text>
                <View style={styles.chipWrap}>
                  {CATEGORIES.map((c) => {
                    const active = c.value === category;
                    return (
                      <Pressable
                        key={c.value}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setCategory(c.value)}
                      >
                        <Text
                          style={[styles.chipText, active && styles.chipTextActive]}
                        >
                          {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.inputLabel, { marginTop: spacing.md }]}>
                  Describe your issue
                </Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Give us the details — order code, what happened, when…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  maxLength={4000}
                />
                <View style={styles.formActions}>
                  <Pressable
                    style={[styles.formBtn, styles.formBtnGhost]}
                    onPress={() => {
                      setShowForm(false);
                      setSubject('');
                      setMessage('');
                      setCategory('OTHER');
                    }}
                    disabled={submitting}
                  >
                    <Text style={styles.formBtnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.formBtn, styles.formBtnPrimary]}
                    onPress={onSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <Text style={styles.formBtnPrimaryText}>Submit ticket</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.raiseBtn, pressed && styles.pressed]}
              onPress={() => setShowForm(true)}
            >
              <Ionicons name="add-circle" size={22} color={colors.white} />
              <Text style={styles.raiseBtnText}>Raise a ticket</Text>
            </Pressable>
          )}

          {/* Tickets */}
          <Text style={styles.sectionLabel}>YOUR TICKETS</Text>
          {tickets.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name="chatbubbles-outline"
                size={36}
                color={colors.textMuted}
              />
              <Text style={styles.emptyTitle}>No tickets yet</Text>
              <Text style={styles.emptyText}>
                Raised a problem? Your support tickets and their replies will
                appear here so you can follow up any time.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {tickets.map((t: TicketSummary, i) => {
                const s = STATUS_STYLE[t.status];
                return (
                  <Pressable
                    key={t.id}
                    style={({ pressed }) => [
                      styles.ticketRow,
                      i === tickets.length - 1 && styles.ticketRowLast,
                      pressed && styles.ticketRowPressed,
                    ]}
                    onPress={() =>
                      router.push({ pathname: '/support-ticket', params: { id: t.id } })
                    }
                  >
                    <View style={styles.ticketLeft}>
                      <Text style={styles.ticketSubject} numberOfLines={1}>
                        {t.subject}
                      </Text>
                      {t.lastMessage ? (
                        <Text style={styles.ticketPreview} numberOfLines={1}>
                          {t.lastMessage.fromRider ? 'You: ' : 'Support: '}
                          {t.lastMessage.body}
                        </Text>
                      ) : (
                        <Text style={styles.ticketPreview}>No messages yet</Text>
                      )}
                      <View style={styles.ticketMetaRow}>
                        <View style={[styles.statusChip, { backgroundColor: s.bg }]}>
                          <Text style={[styles.statusChipText, { color: s.fg }]}>
                            {s.label}
                          </Text>
                        </View>
                        <Text style={styles.ticketTime}>
                          Updated {fmtWhen(t.updatedAt)}
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* FAQ */}
          <Text style={styles.sectionLabel}>FREQUENTLY ASKED</Text>
          <View style={styles.card}>
            {FAQ.map((item, i) => {
              const open = openFaq === i;
              return (
                <View
                  key={item.q}
                  style={[styles.faqRow, i === FAQ.length - 1 && styles.faqRowLast]}
                >
                  <Pressable
                    style={styles.faqQuestion}
                    onPress={() => toggleFaq(i)}
                    hitSlop={6}
                  >
                    <Text style={styles.faqQuestionText}>{item.q}</Text>
                    <Ionicons
                      name={open ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.textMuted}
                    />
                  </Pressable>
                  {open ? <Text style={styles.faqAnswer}>{item.a}</Text> : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
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
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  pressed: { opacity: 0.7 },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },

  raiseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    ...shadow.card,
  },
  raiseBtnText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.md,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  formPad: { padding: spacing.lg },
  formTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: font.size.md,
    color: colors.text,
  },
  inputMultiline: { minHeight: 110 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    fontWeight: font.weight.medium,
  },
  chipTextActive: { color: colors.white, fontWeight: font.weight.semibold },
  formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  formBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBtnGhost: { borderWidth: 1, borderColor: colors.border },
  formBtnGhostText: {
    color: colors.textMuted,
    fontWeight: font.weight.semibold,
    fontSize: font.size.sm,
  },
  formBtnPrimary: { backgroundColor: colors.primary },
  formBtnPrimaryText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.sm,
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
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  ticketRowLast: { borderBottomWidth: 0 },
  ticketRowPressed: { backgroundColor: colors.primarySoft },
  ticketLeft: { flex: 1, marginRight: spacing.sm },
  ticketSubject: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  ticketPreview: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  ticketMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusChipText: { fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.5 },
  ticketTime: { fontSize: font.size.xs, color: colors.textMuted },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  emptyText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },

  faqRow: {
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  faqRowLast: { borderBottomWidth: 0 },
  faqQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  faqQuestionText: {
    flex: 1,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  faqAnswer: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    paddingBottom: spacing.md,
  },
});
