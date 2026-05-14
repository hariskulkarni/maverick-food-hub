/**
 * Reusable celebratory animation — a checkmark badge that springs in, ringed
 * by a short burst of confetti-ish dots.
 *
 * Built on react-native-reanimated. Drop it anywhere and drive it with the
 * `visible` prop; `onDone` fires once the entrance animation settles so the
 * parent can advance, dismiss, or navigate.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors } from '../lib/theme';

interface SuccessCelebrationProps {
  /** When true, the badge + confetti play their entrance. */
  visible: boolean;
  /** Fires once the entrance animation has settled. */
  onDone?: () => void;
}

const BADGE_SIZE = 96;
const CONFETTI_COUNT = 12;
const CONFETTI_DISTANCE = 86;
const CONFETTI_COLORS = [colors.primary, colors.success, colors.warning, colors.primaryDark];

/** Pre-computed so the burst pattern is stable across renders. */
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
  const angle = (i / CONFETTI_COUNT) * Math.PI * 2;
  return {
    key: i,
    dx: Math.cos(angle) * CONFETTI_DISTANCE,
    dy: Math.sin(angle) * CONFETTI_DISTANCE,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 8 + (i % 3) * 3,
  };
});

function ConfettiDot({
  dx,
  dy,
  color,
  size,
  progress,
}: {
  dx: number;
  dy: number;
  color: string;
  size: number;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value < 0.05 ? 0 : 1 - progress.value,
    transform: [
      { translateX: dx * progress.value },
      { translateY: dy * progress.value },
      { scale: 0.4 + progress.value * 0.6 },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.confetti,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export function SuccessCelebration({ visible, onDone }: SuccessCelebrationProps) {
  // Badge entrance.
  const badgeScale = useSharedValue(0);
  const badgeOpacity = useSharedValue(0);
  // Checkmark pop, staggered just after the badge.
  const checkScale = useSharedValue(0);
  // Shared 0→1 driver for the confetti burst.
  const burst = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      badgeOpacity.value = withTiming(1, { duration: 160 });
      badgeScale.value = withSpring(1, { damping: 9, stiffness: 140, mass: 0.7 }, (finished) => {
        if (finished && onDone) runOnJS(onDone)();
      });
      checkScale.value = withDelay(
        120,
        withSequence(
          withSpring(1.15, { damping: 6, stiffness: 200 }),
          withSpring(1, { damping: 10, stiffness: 180 })
        )
      );
      burst.value = withDelay(80, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
    } else {
      // Reset so a re-show replays cleanly.
      cancelAnimation(badgeScale);
      cancelAnimation(badgeOpacity);
      cancelAnimation(checkScale);
      cancelAnimation(burst);
      badgeScale.value = 0;
      badgeOpacity.value = 0;
      checkScale.value = 0;
      burst.value = 0;
    }
    // onDone intentionally omitted — we don't want a new callback identity to replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeOpacity.value,
    transform: [{ scale: badgeScale.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  if (!visible) return null;

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.stage}>
        {CONFETTI.map((c) => (
          <ConfettiDot
            key={c.key}
            dx={c.dx}
            dy={c.dy}
            color={c.color}
            size={c.size}
            progress={burst}
          />
        ))}

        <Animated.View style={[styles.badge, badgeStyle]}>
          {/* A checkmark drawn from two rotated bars — no icon dependency. */}
          <Animated.View style={[styles.check, checkStyle]}>
            <View style={styles.checkShort} />
            <View style={styles.checkLong} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confetti: {
    position: 'absolute',
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  check: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The short arm of the tick.
  checkShort: {
    position: 'absolute',
    width: 16,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.white,
    transform: [{ rotate: '45deg' }, { translateX: -10 }, { translateY: 6 }],
  },
  // The long arm of the tick.
  checkLong: {
    position: 'absolute',
    width: 30,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.white,
    transform: [{ rotate: '-45deg' }, { translateX: 4 }, { translateY: 2 }],
  },
});
