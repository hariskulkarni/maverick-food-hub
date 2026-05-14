/**
 * IncentiveProgressCard — renders one incentive slab: title, description, a
 * progress bar toward the delivery target, the bonus on offer, and a celebratory
 * "Achieved" state once the rider clears the target.
 */
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Incentive } from '../lib/api-payments';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

interface Props {
  incentive: Incentive;
}

export function IncentiveProgressCard({ incentive }: Props) {
  const { title, description, period, targetDeliveries, bonusAmount, deliveriesDone, achieved, remaining } =
    incentive;

  const pct =
    targetDeliveries > 0 ? Math.max(0, Math.min(1, deliveriesDone / targetDeliveries)) : 0;
  const periodLabel = period === 'WEEKLY' ? 'This week' : 'Today';

  return (
    <View style={[styles.card, achieved && styles.cardAchieved]}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        <View style={[styles.bonusPill, achieved && styles.bonusPillAchieved]}>
          <Text style={[styles.bonusAmount, achieved && styles.bonusAmountAchieved]}>
            +{rupees(bonusAmount)}
          </Text>
          <Text style={[styles.bonusLabel, achieved && styles.bonusLabelAchieved]}>bonus</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(pct * 100)}%` },
            achieved && styles.progressFillAchieved,
          ]}
        />
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.countText}>
          <Text style={styles.countDone}>{deliveriesDone}</Text>
          <Text style={styles.countSep}> / {targetDeliveries} deliveries</Text>
        </Text>
        {achieved ? (
          <View style={styles.achievedRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.achievedText}>Achieved 🎉</Text>
          </View>
        ) : (
          <Text style={styles.remainingText}>
            {remaining} more {periodLabel.toLowerCase()}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardAchieved: {
    borderColor: colors.success,
    backgroundColor: colors.successSoft,
  },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1 },
  title: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  description: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 19,
  },

  bonusPill: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 72,
  },
  bonusPillAchieved: { backgroundColor: colors.white },
  bonusAmount: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.primaryDark,
  },
  bonusAmountAchieved: { color: colors.success },
  bonusLabel: {
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  bonusLabelAchieved: { color: colors.success },

  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  progressFillAchieved: { backgroundColor: colors.success },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  countText: { fontSize: font.size.sm },
  countDone: {
    fontWeight: font.weight.bold,
    color: colors.text,
    fontSize: font.size.md,
  },
  countSep: { color: colors.textMuted },
  remainingText: {
    fontSize: font.size.sm,
    color: colors.primaryDark,
    fontWeight: font.weight.semibold,
  },
  achievedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  achievedText: {
    fontSize: font.size.sm,
    color: colors.success,
    fontWeight: font.weight.bold,
  },
});
