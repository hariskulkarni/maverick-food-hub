/**
 * Messages — the rider's two conversation threads with Flavrly staff.
 *
 * Two logical threads:
 *   • Platform Support (party SUPER_ADMIN) — always available.
 *   • My Restaurant (party ADMIN) — only for DEDICATED riders; greyed out as
 *     "unavailable" for FLEET riders with no dedicated restaurant.
 *
 * Each row shows who, the last-message preview, when, and an unread badge.
 * Tapping an existing conversation opens it by `id`; tapping a party that has
 * no conversation yet opens a composable thread by `party` (created on first
 * send). Wired to GET /api/rider/messages.
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  api,
  ApiError,
  type RiderConversation,
  type RiderMe,
  type MessageParty,
} from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { colors, spacing, radius, font } from '../lib/theme';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** A single thread row — either an existing conversation or a not-yet-created party. */
function ThreadRow({
  icon,
  tint,
  title,
  subtitle,
  conversation,
  disabled,
  disabledHint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  subtitle: string;
  conversation: RiderConversation | null;
  disabled?: boolean;
  disabledHint?: string;
  onPress?: () => void;
}) {
  const last = conversation?.lastMessage ?? null;
  const preview = disabled
    ? disabledHint
    : last
      ? `${last.sender === 'RIDER' ? 'You: ' : ''}${last.body}`
      : 'No messages yet — tap to start';
  const unread = conversation?.unreadCount ?? 0;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint + '1a' }]}>
        <Ionicons name={icon} size={22} color={disabled ? colors.textMuted : tint} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text
            style={[styles.rowTitle, disabled && styles.rowTitleDisabled]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {last && !disabled ? (
            <Text style={styles.rowTime}>{fmtWhen(last.createdAt)}</Text>
          ) : null}
        </View>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
        <Text
          style={[styles.rowPreview, disabled && styles.rowPreviewDisabled]}
          numberOfLines={1}
        >
          {preview}
        </Text>
      </View>
      {disabled ? (
        <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
      ) : unread > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

export default function MessagesScreen() {
  const [conversations, setConversations] = useState<RiderConversation[]>([]);
  const [me, setMe] = useState<RiderMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [convRes, meRes] = await Promise.all([
        api.conversations(),
        api.me().catch(() => null),
      ]);
      setConversations(convRes.conversations);
      if (meRes) setMe(meRes);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Could not load your messages.'
      );
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

  function openThread(party: MessageParty, conversation: RiderConversation | null) {
    if (conversation) {
      router.push({ pathname: '/conversation', params: { id: conversation.id } });
    } else {
      router.push({ pathname: '/conversation', params: { party } });
    }
  }

  const platformConv =
    conversations.find((c) => c.party === 'SUPER_ADMIN') ?? null;
  const restaurantConv = conversations.find((c) => c.party === 'ADMIN') ?? null;

  // A rider can message their restaurant if they already have an ADMIN thread,
  // or if they're DEDICATED (the backend will create it on first send).
  const hasDedicatedRestaurant =
    !!restaurantConv || me?.riderType === 'DEDICATED';
  const restaurantName =
    restaurantConv?.restaurantName ??
    me?.dedicatedRestaurant?.name ??
    'Your restaurant';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Messages" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && conversations.length === 0 ? (
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
        >
          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          <Text style={styles.intro}>
            Chat directly with Oak &amp; Sizzler staff — your restaurant&apos;s team
            and the platform support desk.
          </Text>

          <View style={styles.list}>
            <ThreadRow
              icon="headset-outline"
              tint={colors.primary}
              title="Platform Support"
              subtitle="Flavrly support desk"
              conversation={platformConv}
              onPress={() => openThread('SUPER_ADMIN', platformConv)}
            />
            <ThreadRow
              icon="restaurant-outline"
              tint={colors.success}
              title="My Restaurant"
              subtitle={restaurantName}
              conversation={restaurantConv}
              disabled={!hasDedicatedRestaurant}
              disabledHint="Available for dedicated riders only"
              onPress={() => openThread('ADMIN', restaurantConv)}
            />
          </View>

          {!hasDedicatedRestaurant ? (
            <Text style={styles.footnote}>
              You&apos;re a fleet rider, so you&apos;re not tied to one restaurant. Use
              Platform Support for any help you need.
            </Text>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  intro: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },

  list: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowPressed: { backgroundColor: colors.primarySoft },
  rowDisabled: { opacity: 0.6 },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  rowTitleDisabled: { color: colors.textMuted },
  rowTime: { fontSize: font.size.xs, color: colors.textMuted },
  rowSubtitle: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  rowPreview: {
    fontSize: font.size.sm,
    color: colors.text,
    marginTop: 3,
  },
  rowPreviewDisabled: { color: colors.textMuted, fontStyle: 'italic' },

  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: font.weight.bold,
  },

  footnote: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});
