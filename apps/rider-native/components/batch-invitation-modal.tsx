/**
 * BatchInvitationModal — full-screen "add this delivery to your route?" prompt.
 *
 * Shown when the dispatcher has invited this rider to batch a new order onto
 * their current trip. The modal:
 *   - Pops with a strong scale-in animation + 3 short vibration pulses
 *   - Counts down a big circular ring from 15s → 0; ring turns red below 5s
 *   - Shows: extra earnings (BIG ₹), detour distance, pickup ETA
 *   - Auto-declines silently when the timer hits 0
 *
 * Mounted in the (app) layout so it floats above every tab.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, spacing, shadow } from '../lib/theme';
import type { BatchInvitation } from '../lib/api';

interface Props {
  visible: boolean;
  invitation: BatchInvitation | null;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}

const RING_SIZE = 120;
const RING_THICKNESS = 10;
const VIBRATION_PATTERN = [0, 300, 100, 300, 100, 300];

export function BatchInvitationModal({
  visible,
  invitation,
  onAccept,
  onDecline,
}: Props) {
  // Pop-in scale animation drives both the modal entrance and the ring's
  // "drawing in" feel. Starts at 0.6 and springs to 1.0.
  const scale = useRef(new Animated.Value(0.6)).current;
  // Local countdown: re-seeded every time a fresh invitation appears.
  const [secondsLeft, setSecondsLeft] = useState(15);
  // The invitation id we last fired the vibrate / animation for — prevents a
  // re-render from re-vibrating on every secondsLeft tick.
  const lastFiredIdRef = useRef<string | null>(null);

  // Total window (for ring progress). Server stamps invitedAt/expiresAt so
  // we infer it from the inv rather than hardcoding 15s — keeps us robust if
  // the server constant ever changes.
  const totalSeconds = useRef(15);

  useEffect(() => {
    if (!visible || !invitation) {
      scale.setValue(0.6);
      lastFiredIdRef.current = null;
      return;
    }

    if (lastFiredIdRef.current !== invitation.id) {
      // Fresh invitation — kick off the entry animation + vibration once.
      lastFiredIdRef.current = invitation.id;
      try {
        Vibration.vibrate(VIBRATION_PATTERN);
      } catch {
        /* swallow */
      }
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 90,
      }).start();

      const total = Math.max(
        1,
        Math.round(
          (new Date(invitation.expiresAt).getTime() -
            new Date(invitation.invitedAt).getTime()) /
            1000
        )
      );
      totalSeconds.current = total;
      setSecondsLeft(Math.max(0, invitation.secondsLeft));
    } else {
      // Same invitation, fresh data — just reconcile secondsLeft so server
      // and client agree.
      setSecondsLeft(Math.max(0, invitation.secondsLeft));
    }
  }, [visible, invitation, scale]);

  // Per-second client-side countdown. The poll only ticks every 3s, so this
  // gives the rider a smooth 1Hz number to look at between server checks.
  useEffect(() => {
    if (!visible || !invitation) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1_000);
    return () => clearInterval(id);
  }, [visible, invitation]);

  // Auto-decline when the timer reaches 0. We fire silently (no extra UI)
  // so the modal just disappears — the parent will refetch on next poll.
  useEffect(() => {
    if (!visible || !invitation) return;
    if (secondsLeft <= 0) {
      onDecline(invitation.id);
    }
  }, [secondsLeft, visible, invitation, onDecline]);

  if (!invitation) return null;

  const isUrgent = secondsLeft <= 5;
  const ringColor = isUrgent ? colors.danger : colors.primary;
  const progress = Math.max(0, Math.min(1, secondsLeft / totalSeconds.current));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => onDecline(invitation.id)}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
          <View style={styles.headerRow}>
            <Ionicons name="flash" size={18} color={colors.primary} />
            <Text style={styles.eyebrow}>Quick batch offer</Text>
          </View>

          <Text style={styles.title}>Add this delivery?</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            Pickup from {invitation.order.branchName}
          </Text>

          {/* Countdown ring — two-half technique like ProgressRing. */}
          <View style={styles.ringWrap}>
            <CountdownRing color={ringColor} progress={progress} />
            <View style={styles.ringCenter} pointerEvents="none">
              <Text style={[styles.ringNum, isUrgent && { color: colors.danger }]}>
                {secondsLeft}
              </Text>
              <Text style={styles.ringLabel}>seconds</Text>
            </View>
          </View>

          {/* The headline economics — extra ₹ takes the spotlight. */}
          <View style={styles.earningsBlock}>
            <Text style={styles.earningsLabel}>EXTRA EARNINGS</Text>
            <Text style={styles.earningsAmount}>
              +₹{Math.round(invitation.extraEarnings)}
            </Text>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaCell}>
              <Text style={styles.metaValue}>
                +{invitation.detourKm.toFixed(1)} km
              </Text>
              <Text style={styles.metaLabel}>detour</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaCell}>
              <Text style={styles.metaValue}>
                {invitation.pickupEtaMin ?? '—'} min
              </Text>
              <Text style={styles.metaLabel}>to pickup</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => onDecline(invitation.id)}
              style={({ pressed }) => [
                styles.btn,
                styles.declineBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.declineLabel}>Decline</Text>
            </Pressable>
            <Pressable
              onPress={() => onAccept(invitation.id)}
              style={({ pressed }) => [
                styles.btn,
                styles.acceptBtn,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.acceptLabel}>Accept</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * A simple two-half circle ring that fills as `progress` (0–1) approaches 1.
 * Built with Views to avoid pulling in react-native-svg here.
 */
function CountdownRing({ color, progress }: { color: string; progress: number }) {
  const size = RING_SIZE;
  const r = size / 2;
  const rightDeg = progress <= 0.5 ? progress * 360 : 180;
  const leftDeg = progress <= 0.5 ? 0 : (progress - 0.5) * 360;

  return (
    <View style={[ringStyles.wrap, { width: size, height: size }]}>
      <View
        style={[
          ringStyles.track,
          {
            width: size,
            height: size,
            borderRadius: r,
            borderWidth: RING_THICKNESS,
            borderColor: colors.border,
          },
        ]}
      />
      <View style={[ringStyles.half, ringStyles.halfLeft, { width: r, height: size }]}>
        <View
          style={[
            ringStyles.fill,
            {
              width: size,
              height: size,
              borderRadius: r,
              borderWidth: RING_THICKNESS,
              borderColor: color,
              transform: [{ rotate: `${leftDeg}deg` }],
            },
          ]}
        />
      </View>
      <View style={[ringStyles.half, ringStyles.halfRight, { width: r, height: size }]}>
        <View
          style={[
            ringStyles.fill,
            ringStyles.fillRight,
            {
              width: size,
              height: size,
              borderRadius: r,
              borderWidth: RING_THICKNESS,
              borderColor: color,
              transform: [{ rotate: `${rightDeg}deg` }],
            },
          ]}
        />
      </View>
    </View>
  );
}

const ringStyles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute' },
  half: { position: 'absolute', top: 0, overflow: 'hidden' },
  halfLeft: { left: 0 },
  halfRight: { right: 0 },
  fill: { position: 'absolute', top: 0, left: 0, backgroundColor: 'transparent' },
  fillRight: { left: undefined, right: 0 },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadow.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  eyebrow: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.md,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.sm,
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringNum: {
    fontSize: 34,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  ringLabel: {
    fontSize: 10,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  earningsBlock: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  earningsLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.success,
    letterSpacing: 1.5,
  },
  earningsAmount: {
    fontSize: 48,
    fontWeight: font.weight.bold,
    color: colors.success,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  metaCell: { paddingHorizontal: spacing.md, alignItems: 'center' },
  metaDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  metaValue: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  metaLabel: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    backgroundColor: colors.border,
  },
  acceptBtn: {
    backgroundColor: colors.success,
  },
  declineLabel: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  acceptLabel: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.white,
  },
});
