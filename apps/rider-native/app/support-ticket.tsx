/**
 * Support ticket thread — a single ticket's chat-style conversation.
 *
 * Reads the ticket `id` from the route params, shows the subject + status, a
 * message list (rider messages right-aligned saffron, support left-aligned
 * card), and a reply composer pinned to the bottom. Refreshes after sending.
 *
 * Wired to GET/POST /api/rider/support/[id].
 */
import { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  SafeAreaView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import {
  growth,
  type TicketThread,
  type TicketStatus,
  type TicketMessage,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const STATUS_STYLE: Record<TicketStatus, { bg: string; fg: string; label: string }> = {
  OPEN: { bg: colors.primarySoft, fg: colors.primary, label: 'Open' },
  IN_PROGRESS: { bg: '#fdf4e3', fg: colors.warning, label: 'In progress' },
  WAITING_ON_RIDER: { bg: '#fdf4e3', fg: colors.warning, label: 'Needs your reply' },
  RESOLVED: { bg: colors.successSoft, fg: colors.success, label: 'Resolved' },
  CLOSED: { bg: colors.bg, fg: colors.textMuted, label: 'Closed' },
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function SupportTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = typeof id === 'string' ? id : '';

  const [thread, setThread] = useState<TicketThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!ticketId) {
      setError('Missing ticket.');
      return;
    }
    setError(null);
    try {
      setThread(await growth.ticket(ticketId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this ticket.');
    }
  }, [ticketId]);

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

  async function onSend() {
    const text = reply.trim();
    if (!text || sending || !ticketId) return;
    setSending(true);
    try {
      const updated = await growth.replyTicket(ticketId, text);
      setThread(updated);
      setReply('');
      // Let the list re-render, then scroll to the freshest message.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  }

  const status = thread ? STATUS_STYLE[thread.status] : null;
  const isClosed = thread?.status === 'CLOSED';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {thread?.subject ?? 'Ticket'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !thread ? (
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
      ) : thread ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          {/* Status bar */}
          <View style={styles.statusBar}>
            {status ? (
              <View style={[styles.statusChip, { backgroundColor: status.bg }]}>
                <Text style={[styles.statusChipText, { color: status.fg }]}>
                  {status.label}
                </Text>
              </View>
            ) : null}
            <Text style={styles.statusMeta}>
              Opened {fmtWhen(thread.createdAt)}
            </Text>
          </View>

          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }
          >
            {thread.messages.map((m: TicketMessage) => {
              const mine = m.fromRider;
              return (
                <View
                  key={m.id}
                  style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}
                >
                  <View
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                  >
                    {!mine ? (
                      <Text style={styles.bubbleAuthor}>
                        {m.authorName || 'Support'}
                      </Text>
                    ) : null}
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {m.body}
                    </Text>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                      {fmtWhen(m.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Composer */}
          {isClosed ? (
            <View style={styles.closedNotice}>
              <Ionicons name="lock-closed" size={15} color={colors.textMuted} />
              <Text style={styles.closedNoticeText}>
                This ticket is closed. Raise a new ticket if you still need help.
              </Text>
            </View>
          ) : (
            <View style={styles.composer}>
              <TextInput
                style={styles.composerInput}
                value={reply}
                onChangeText={setReply}
                placeholder="Type your reply…"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={4000}
              />
              <Pressable
                style={[
                  styles.sendBtn,
                  (!reply.trim() || sending) && styles.sendBtnDisabled,
                ]}
                onPress={onSend}
                disabled={!reply.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={colors.white} />
                )}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusChipText: { fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.5 },
  statusMeta: { fontSize: font.size.xs, color: colors.textMuted },

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    overflow: 'hidden',
  },

  messages: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleAuthor: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.primary,
    marginBottom: 2,
  },
  bubbleText: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
  },
  bubbleTextMine: { color: colors.white },
  bubbleTime: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
  },
  bubbleTimeMine: { color: colors.white, opacity: 0.8 },

  closedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  closedNoticeText: {
    flex: 1,
    fontSize: font.size.xs,
    color: colors.textMuted,
    lineHeight: 17,
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadow.card,
  },
  composerInput: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.size.md,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.border },
});
