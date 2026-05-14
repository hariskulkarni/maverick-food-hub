/**
 * ScreenHeader — the shared back-header for every pushed (non-tab) screen.
 *
 * Why this exists: each feature screen used to hand-roll its own header inside
 * a `SafeAreaView` imported from `react-native` — which is a no-op on Android.
 * The header rendered *under* the status bar / camera cutout, so on devices
 * like the Pixel the back arrow wasn't tappable and the title was clipped.
 *
 * This component owns the top safe-area inset itself (via `useSafeAreaInsets`),
 * guarantees a 44×44 touch target for the back button, and truncates long
 * titles cleanly so they never overflow. Screens that use it should keep their
 * root `SafeAreaView` (from `react-native-safe-area-context`) on the bottom
 * edge only — the top edge is handled here.
 */
import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, font } from '../lib/theme';

/** Square touch target — meets the 44pt minimum tap size on every device. */
const HIT = 44;

export function ScreenHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  /** Optional element pinned to the right of the title (e.g. a saving spinner). */
  right?: ReactNode;
  /** Defaults to `router.back()`. */
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.xs }]}>
      <Pressable
        onPress={onBack ?? (() => router.back())}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
      >
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </Pressable>

      <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
        {title}
      </Text>

      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: HIT / 2,
  },
  iconBtnPressed: { backgroundColor: colors.primarySoft },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  // Mirrors the back button's width so the title stays optically centred.
  right: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
