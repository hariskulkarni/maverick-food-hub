/**
 * IncomingOrderPopup — full-screen, attention-grabbing modal that appears the
 * moment a brand-new pool order lands while the rider is online.
 *
 * Visceral feedback stack:
 *   - Plays a sound + vibrates (via useOrderSound) on mount
 *   - Slides up from the bottom (Animated, no extra deps)
 *   - Semi-transparent backdrop dims the rest of the app
 *   - Auto-dismisses after 20s if untouched
 *
 * Mounted at the (app) layout level so it floats over every tab regardless of
 * which screen the rider is looking at. Two big actions: VIEW ORDER (jump to
 * the pool tab) and DISMISS.
 */
import { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { useOrderSound } from '../lib/use-order-sound';

export interface IncomingOrderPopupOrder {
  id: string;
  code: string;
  branchName: string;
  customerArea: string;
  /** Already-formatted in caller (or numeric — we coerce). */
  earnings: number | string;
  pickupKm: number;
}

interface Props {
  visible: boolean;
  order: IncomingOrderPopupOrder | null;
  onView: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 20_000;

function rupees(value: number | string): string {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

export function IncomingOrderPopup({ visible, order, onView, onDismiss }: Props) {
  const slide = useRef(new Animated.Value(0)).current;
  const sound = useOrderSound();

  // Drive the slide-up + sound/vibration whenever a new order becomes visible.
  useEffect(() => {
    if (!visible || !order) {
      slide.setValue(0);
      return;
    }

    sound.playNewOrder();

    Animated.timing(slide, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      onDismiss();
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
    // sound is stable across renders (hook returns stable callbacks); we only
    // want to re-trigger when the order identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, order?.id]);

  if (!order) return null;

  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        {/* Tap the backdrop to dismiss — same as pressing DISMISS. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        <Animated.View
          style={[styles.cardWrap, { transform: [{ translateY }] }]}
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.iconBadge}>
                <Ionicons name="flash" size={20} color={colors.white} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.headline}>New order ready</Text>
                <Text style={styles.subhead} numberOfLines={1}>
                  Tap VIEW ORDER to claim it
                </Text>
              </View>
              <View style={styles.codePill}>
                <Text style={styles.codePillText} numberOfLines={1}>
                  {order.code}
                </Text>
              </View>
            </View>

            <View style={styles.body}>
              <Row
                icon="restaurant-outline"
                label="PICKUP"
                value={order.branchName || 'Restaurant'}
              />
              <Row
                icon="location-outline"
                label="DROP AREA"
                value={order.customerArea || 'Customer'}
              />
              <View style={styles.metaRow}>
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>YOU EARN</Text>
                  <Text style={styles.earnings}>{rupees(order.earnings)}</Text>
                </View>
                <View style={styles.metaDivider} />
                <View style={styles.metaCell}>
                  <Text style={styles.metaLabel}>PICKUP</Text>
                  <Text style={styles.distance}>
                    {Number.isFinite(order.pickupKm) && order.pickupKm > 0
                      ? `${order.pickupKm.toFixed(1)} km`
                      : 'Nearby'}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={onDismiss}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && styles.btnGhostPressed,
                ]}
              >
                <Text style={styles.btnGhostText}>DISMISS</Text>
              </Pressable>
              <Pressable
                onPress={onView}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && styles.btnPrimaryPressed,
                ]}
              >
                <Ionicons name="arrow-forward" size={18} color={colors.white} />
                <Text style={styles.btnPrimaryText}>VIEW ORDER</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 12, 8, 0.55)',
    justifyContent: 'flex-end',
  },
  cardWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    ...shadow.card,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headline: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subhead: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  codePill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    maxWidth: 110,
  },
  codePillText: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.primaryDark,
  },

  body: { marginTop: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  rowText: { flex: 1 },
  rowLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
  },
  rowValue: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
    marginTop: 1,
  },

  metaRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  metaCell: { flex: 1, alignItems: 'center' },
  metaDivider: { width: 1, height: 28, backgroundColor: colors.border },
  metaLabel: {
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
  },
  earnings: {
    marginTop: 4,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.success,
  },
  distance: {
    marginTop: 4,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },

  actions: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  btnGhost: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostPressed: { backgroundColor: colors.bg },
  btnGhostText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryPressed: { backgroundColor: colors.primaryDark },
  btnPrimaryText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.white,
    letterSpacing: 1,
  },
});
