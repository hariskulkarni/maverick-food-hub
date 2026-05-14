/**
 * TierBadge — a reusable, color-coded loyalty-tier badge.
 *
 * Each of the four rungs gets its own metallic-ish colour and icon. Drop it
 * anywhere the rider's standing should show — the "My Tier" hero, the Profile
 * card, the Earnings header — in a compact (`sm`) or prominent (`lg`) size.
 */
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, font } from '../lib/theme';

export type TierName = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

interface TierStyle {
  /** Pill / fill colour. */
  bg: string;
  /** Text + icon colour against `bg`. */
  fg: string;
  /** Ionicons glyph name. */
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

const TIER_STYLES: Record<TierName, TierStyle> = {
  BRONZE: { bg: '#b08d57', fg: '#ffffff', icon: 'shield-outline', label: 'Bronze' },
  SILVER: { bg: '#9ca3af', fg: '#ffffff', icon: 'shield-half', label: 'Silver' },
  GOLD: { bg: colors.primary, fg: '#ffffff', icon: 'shield', label: 'Gold' },
  PLATINUM: { bg: '#3b4a6b', fg: '#ffffff', icon: 'diamond', label: 'Platinum' },
};

interface TierBadgeProps {
  tier: TierName;
  /** `sm` for inline use, `lg` for hero placement. Defaults to `sm`. */
  size?: 'sm' | 'lg';
}

export function TierBadge({ tier, size = 'sm' }: TierBadgeProps) {
  const s = TIER_STYLES[tier] ?? TIER_STYLES.BRONZE;
  const lg = size === 'lg';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: s.bg },
        lg ? styles.badgeLg : styles.badgeSm,
      ]}
    >
      <Ionicons
        name={s.icon}
        size={lg ? 20 : 13}
        color={s.fg}
        style={lg ? styles.iconLg : styles.iconSm}
      />
      <Text
        style={[
          styles.label,
          { color: s.fg },
          lg ? styles.labelLg : styles.labelSm,
        ]}
      >
        {s.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
  },
  badgeSm: { paddingHorizontal: 10, paddingVertical: 4 },
  badgeLg: { paddingHorizontal: 18, paddingVertical: 9 },
  iconSm: { marginRight: 4 },
  iconLg: { marginRight: 8 },
  label: {
    fontWeight: font.weight.bold,
    letterSpacing: 0.8,
  },
  labelSm: { fontSize: font.size.xs },
  labelLg: { fontSize: font.size.md, letterSpacing: 1 },
});
