/**
 * Shown on the delivery screen when background location is not allowed:
 * foreground tracking still works, but it pauses whenever Flavrly is not on
 * screen (e.g. while the rider navigates in Google Maps).
 */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BackgroundTrackingStatus } from '../lib/delivery-tracking';
import { colors, spacing, radius, font } from '../lib/theme';

export function BackgroundLocationBanner({
  status,
  onEnable,
  onOpenSettings,
}: {
  status: BackgroundTrackingStatus;
  onEnable: () => void;
  onOpenSettings: () => void;
}) {
  if (status !== 'needs-permission' && status !== 'blocked') return null;
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <View style={styles.head}>
        <Ionicons name="pause-circle-outline" size={20} color={colors.warning} />
        <Text style={styles.title}>Tracking pauses in the background</Text>
      </View>
      <Text style={styles.body}>
        Background location is off, so the customer&apos;s live map stops updating while Flavrly is not on
        screen (for example while you use Google Maps or lock your phone).
      </Text>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        onPress={status === 'needs-permission' ? onEnable : onOpenSettings}
        accessibilityRole="button"
      >
        <Ionicons name={status === 'needs-permission' ? 'location-outline' : 'settings-outline'} size={16} color={colors.white} />
        <Text style={styles.btnText}>{status === 'needs-permission' ? 'Turn on background location' : 'Open settings'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  body: { fontSize: font.size.sm, color: colors.text, lineHeight: 20 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.warning,
  },
  btnPressed: { opacity: 0.85 },
  btnText: { color: colors.white, fontSize: font.size.sm, fontWeight: font.weight.bold },
});
