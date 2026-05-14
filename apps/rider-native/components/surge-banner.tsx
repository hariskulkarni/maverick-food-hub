/**
 * SurgeBanner — a compact, self-fetching "surge is live" strip.
 *
 * Drop `<SurgeBanner />` at the top of any screen (Home, Earnings). It fetches
 * the live surge zones on mount and renders an eye-catching saffron→amber
 * banner for the hottest zone. Renders nothing when there's no surge, while
 * loading, or on error — so it's safe to embed unconditionally.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { payments, type SurgeZone } from '../lib/api-payments';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

export function SurgeBanner() {
  const [zone, setZone] = useState<SurgeZone | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await payments.surge();
        // Backend already sorts hottest-first — take the top zone.
        if (!cancelled) setZone(res.zones[0] ?? null);
      } catch {
        // Surge is a nice-to-have — stay silent on any failure.
        if (!cancelled) setZone(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!zone) return null;

  // "1.5×" — trim a trailing ".0" so 2.0 reads as "2×".
  const mult = `${Number(zone.multiplier.toFixed(2))}`.replace(/\.0+$/, '');

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <Ionicons name="flash" size={20} color={colors.white} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {mult}× pay live near {zone.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          Go online in {zone.label.toLowerCase()} to earn more
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    ...shadow.card,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  title: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.white,
  },
  sub: {
    fontSize: font.size.xs,
    color: colors.white,
    opacity: 0.92,
    marginTop: 1,
  },
});
