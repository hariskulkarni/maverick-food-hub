/**
 * NewOrderBanner — animated "new orders available" pill shown at the top of
 * the order pool when fresh orders land. Slides + fades in, auto-dismisses
 * after ~4s, and also dismisses on tap. Themed to the saffron brand.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, StyleSheet, Easing } from 'react-native';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const AUTO_DISMISS_MS = 4000;

export function NewOrderBanner({
  count,
  onDismiss,
}: {
  count: number;
  onDismiss: () => void;
}) {
  // 0 = hidden (above + transparent), 1 = resting in place.
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [anim, onDismiss]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-24, 0],
  });

  const label = `🛵 ${count} new order${count === 1 ? '' : 's'} available`;

  return (
    <Animated.View
      style={[styles.wrap, { opacity: anim, transform: [{ translateY }] }]}
    >
      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={styles.text}>{label}</Text>
        <Text style={styles.hint}>Tap to dismiss</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  bannerPressed: {
    backgroundColor: colors.primaryDark,
  },
  text: {
    flex: 1,
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  hint: {
    color: colors.white,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    opacity: 0.85,
    marginLeft: spacing.sm,
  },
});
