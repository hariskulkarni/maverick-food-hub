/**
 * ProgressRing — a polished circular progress indicator built with plain Views.
 *
 * No SVG, no chart library: the ring is drawn with the "two rotated half-circle
 * masks" technique. A circular track sits underneath; two half-disc overlays
 * (each clipped to a semicircle by its parent) rotate to reveal the colored arc.
 * Center shows a big `value` and a small `label`.
 */
import { View, Text, StyleSheet } from 'react-native';
import { colors, font } from '../lib/theme';

interface ProgressRingProps {
  /** 0–1; clamped internally. */
  progress: number;
  /** Outer diameter in px. */
  size: number;
  /** Small caption under the value (e.g. "Daily goal"). */
  label: string;
  /** Big centered text (e.g. "₹1,200"). */
  value: string;
  /** Arc color — defaults to brand saffron. */
  color?: string;
}

export function ProgressRing({
  progress,
  size,
  label,
  value,
  color = colors.primary,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  // Ring thickness scales gently with size, kept within sensible bounds.
  const thickness = Math.max(6, Math.round(size * 0.1));
  const radius = size / 2;
  const innerSize = size - thickness * 2;

  // Right half fills first (0→0.5 → 0°→180°), then the left half (0.5→1).
  const rightDeg = clamped <= 0.5 ? clamped * 360 : 180;
  const leftDeg = clamped <= 0.5 ? 0 : (clamped - 0.5) * 360;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* Track */}
      <View
        style={[
          styles.track,
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: thickness,
            borderColor: colors.border,
          },
        ]}
      />

      {/* Left semicircle clip — holds the second-half arc. */}
      <View style={[styles.half, styles.halfLeft, { width: radius, height: size }]}>
        <View
          style={[
            styles.fill,
            {
              width: size,
              height: size,
              borderRadius: radius,
              borderWidth: thickness,
              borderColor: color,
              transform: [{ rotate: `${leftDeg}deg` }],
            },
          ]}
        />
      </View>

      {/* Right semicircle clip — holds the first-half arc. */}
      <View style={[styles.half, styles.halfRight, { width: radius, height: size }]}>
        <View
          style={[
            styles.fill,
            styles.fillRight,
            {
              width: size,
              height: size,
              borderRadius: radius,
              borderWidth: thickness,
              borderColor: color,
              transform: [{ rotate: `${rightDeg}deg` }],
            },
          ]}
        />
      </View>

      {/* Center label */}
      <View
        style={[
          styles.center,
          { width: innerSize, height: innerSize, borderRadius: innerSize / 2 },
        ]}
      >
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },

  track: { position: 'absolute' },

  // A half-width window that clips its child to a semicircle.
  half: { position: 'absolute', top: 0, overflow: 'hidden' },
  halfLeft: { left: 0 },
  halfRight: { right: 0 },

  // The colored ring, positioned so only the relevant half shows through.
  fill: { position: 'absolute', top: 0, left: 0, backgroundColor: 'transparent' },
  fillRight: { left: undefined, right: 0 },

  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  label: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
