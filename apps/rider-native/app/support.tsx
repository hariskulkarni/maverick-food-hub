/**
 * Help & Support — raise a ticket, track existing ones, open the help center.
 *
 * A "Raise a ticket" form (subject + category chips + message), the rider's
 * ticket list with status chips and last-message previews (tap → thread), and
 * a link to the Help center (searchable articles, app/help.tsx).
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
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import {
  growth,
  type SupportTicketsResponse,
  type TicketSummary,
  type TicketCategory,
  type TicketStatus,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

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

  const tickets = data?.tickets ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Help & Support" />

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

          {/* Help center */}
          <Text style={styles.sectionLabel}>HELP ARTICLES</Text>
          <Pressable
            style={({ pressed }) => [styles.helpCard, pressed && styles.pressed]}
            onPress={() => router.push('/help')}
            accessibilityRole="button"
          >
            <Ionicons name="book-outline" size={22} color={colors.primary} />
            <View style={styles.helpCardText}>
              <Text style={styles.helpCardTitle}>Help center</Text>
              <Text style={styles.helpCardSub}>
                Search guides on shifts, deliveries, earnings, payouts and safety — saved for offline use.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
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

  helpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  helpCardText: { flex: 1, gap: 2 },
  helpCardTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  helpCardSub: { fontSize: font.size.sm, color: colors.textMuted },
});
