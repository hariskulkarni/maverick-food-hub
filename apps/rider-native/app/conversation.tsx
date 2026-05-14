/**
 * Conversation thread — a single rider ⇄ staff chat.
 *
 * Reached two ways:
 *   • with `id`    → an existing conversation, loaded + polled live.
 *   • with `party` → a brand-new thread not yet created; the first send
 *     creates it (POST /api/rider/messages) and we switch to its `id`.
 *
 * Rider messages are right-aligned saffron, staff messages left-aligned card.
 * The composer is pinned to the bottom; the thread polls every ~4s while
 * focused and supports pull-to-refresh. Wired to GET/POST /api/rider/messages
 * and /api/rider/messages/[id].
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  ApiError,
  type RiderConversation,
  type RiderMessage,
  type MessageParty,
} from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const POLL_MS = 4000;

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** A friendly title for the counterpart, given a party + optional conversation. */
function partyTitle(
  party: MessageParty | null,
  conversation: RiderConversation | null
): string {
  const p = conversation?.party ?? party;
  if (p === 'ADMIN') {
    return conversation?.restaurantName ?? 'My Restaurant';
  }
  if (p === 'SUPER_ADMIN') return 'Platform Support';
  return 'Messages';
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id?: string; party?: string }>();
  const initialId = typeof params.id === 'string' ? params.id : '';
  const party: MessageParty | null =
    params.party === 'ADMIN' || params.party === 'SUPER_ADMIN'
      ? params.party
      : null;

  // Once a party-only thread gets its first message, we hold the real id here.
  const [conversationId, setConversationId] = useState(initialId);
  const [conversation, setConversation] = useState<RiderConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  // Keep the latest id available to the poll interval without re-arming it.
  const idRef = useRef(conversationId);
  useEffect(() => {
    idRef.current = conversationId;
  }, [conversationId]);

  const load = useCallback(async () => {
    const id = idRef.current;
    // A party-only thread has nothing to fetch yet — that's not an error.
    if (!id) {
      setError(null);
      return;
    }
    try {
      const res = await api.conversation(id);
      setConversation(res.conversation);
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Could not load this conversation.'
      );
    }
  }, []);

  // Initial load (or skip cleanly for a brand-new party thread).
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

  // Poll every ~4s while the screen is focused and an actual thread exists.
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        if (idRef.current) load();
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function onSend() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      let updated: RiderConversation;
      if (idRef.current) {
        const res = await api.replyToConversation(idRef.current, text);
        updated = res.conversation;
      } else if (party) {
        const res = await api.sendMessageToParty(party, text);
        updated = res.conversation;
        // Switch this screen over to the freshly created conversation.
        setConversationId(updated.id);
        idRef.current = updated.id;
      } else {
        setError('Cannot send — missing conversation.');
        return;
      }
      setConversation(updated);
      setReply('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your message.');
    } finally {
      setSending(false);
    }
  }

  const title = partyTitle(party, conversation);
  const messages = conversation?.messages ?? [];
  const isNewThread = !conversationId && !!party;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title={title} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !conversation && !isNewThread ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={40}
            color={colors.textMuted}
          />
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
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }
            refreshControl={
              conversationId ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                  colors={[colors.primary]}
                />
              ) : undefined
            }
          >
            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={36}
                  color={colors.textMuted}
                />
                <Text style={styles.emptyTitle}>Start the conversation</Text>
                <Text style={styles.emptyText}>
                  Send a message below and {title} will get back to you here.
                </Text>
              </View>
            ) : (
              messages.map((m: RiderMessage) => {
                const mine = m.sender === 'RIDER';
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.bubbleRow,
                      mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
                    ]}
                  >
                    <View
                      style={[
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubbleTheirs,
                      ]}
                    >
                      {!mine ? (
                        <Text style={styles.bubbleAuthor}>
                          {m.senderName || title}
                        </Text>
                      ) : null}
                      <Text
                        style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                      >
                        {m.body}
                      </Text>
                      <Text
                        style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}
                      >
                        {fmtWhen(m.createdAt)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Composer */}
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              value={reply}
              onChangeText={setReply}
              placeholder="Type your message…"
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
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  errorText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
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

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },

  messages: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
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
