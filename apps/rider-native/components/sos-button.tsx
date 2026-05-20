/**
 * SosButton — the reusable one-tap panic control.
 *
 * Two states, driven by `useSos()`:
 *   • idle    — a bold red button. Tapping opens a confirm Alert; on confirm it
 *               captures GPS, buzzes, and fires the SOS.
 *   • ACTIVE  — a pulsing "SOS ACTIVE" panel with a "Mark safe" action that
 *               resolves the alert.
 *
 * Self-contained and embeddable: drop `<SosButton />` (optionally with an
 * `assignmentId`) into the Safety Centre or the active-delivery screen.
 */
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSos } from '../lib/use-sos';
import { ApiError } from '../lib/api';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

interface SosButtonProps {
  /** When fired from an active delivery, tags the alert to that assignment. */
  assignmentId?: string;
}

export function SosButton({ assignmentId }: SosButtonProps) {
  const { activeAlert, loading, trigger, resolve } = useSos();
  const [busy, setBusy] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  // Gentle breathing pulse while an alert is live — draws the eye, never frantic.
  useEffect(() => {
    if (!activeAlert) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [activeAlert, pulse]);

  function confirmTrigger() {
    if (busy) return;
    Alert.alert(
      'Trigger SOS?',
      'Your location and primary emergency contact will be alerted. Use this if you feel unsafe or need urgent help.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trigger SOS',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await trigger(assignmentId);
            } catch (e) {
              Alert.alert(
                'Could not send SOS',
                e instanceof ApiError ? e.message : 'Please try again, or call 112 directly.'
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  function confirmResolve() {
    if (busy) return;
    Alert.alert('Mark yourself safe?', 'This will close the active SOS alert.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: "I'm safe",
        onPress: async () => {
          setBusy(true);
          try {
            await resolve();
          } catch (e) {
            Alert.alert(
              'Could not update',
              e instanceof ApiError ? e.message : 'Please try again.'
            );
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[styles.idleBtn, styles.loadingBtn]}>
        <ActivityIndicator color={colors.white} />
      </View>
    );
  }

  // ── ACTIVE state ──────────────────────────────────────────────────────────
  if (activeAlert) {
    const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
    const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
    return (
      <View style={styles.activeWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeHalo,
            { opacity: haloOpacity, transform: [{ scale: haloScale }] },
          ]}
        />
        <View style={styles.activePanel}>
          <View style={styles.activeHeader}>
            <View style={styles.activeDot} />
            <Text style={styles.activeTitle}>SOS ACTIVE</Text>
          </View>
          <Text style={styles.activeBody}>
            Help has been alerted with your location. Stay where you are if it&apos;s
            safe. Call 112 if you&apos;re in immediate danger.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.safeBtn, pressed && styles.safeBtnPressed]}
            onPress={confirmResolve}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={18} color={colors.danger} />
                <Text style={styles.safeBtnText}>Mark safe / resolve</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Idle state ────────────────────────────────────────────────────────────
  return (
    <Pressable
      style={({ pressed }) => [styles.idleBtn, pressed && styles.idleBtnPressed]}
      onPress={confirmTrigger}
      disabled={busy}
    >
      {busy ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <Ionicons name="alert-circle" size={28} color={colors.white} />
          <View style={styles.idleTextWrap}>
            <Text style={styles.idleTitle}>SOS — Emergency</Text>
            <Text style={styles.idleSub}>Tap to alert support & your contact</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  idleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 76,
    justifyContent: 'center',
    ...shadow.card,
  },
  idleBtnPressed: { backgroundColor: '#9c2d22' },
  loadingBtn: { justifyContent: 'center' },
  idleTextWrap: { flexShrink: 1 },
  idleTitle: {
    color: colors.white,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  idleSub: {
    color: '#f6d6d1',
    fontSize: font.size.xs,
    marginTop: 2,
  },

  activeWrap: { position: 'relative' },
  activeHalo: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: radius.lg + 6,
    backgroundColor: colors.danger,
  },
  activePanel: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.danger,
    padding: spacing.lg,
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  activeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.danger,
  },
  activeTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.danger,
    letterSpacing: 0.5,
  },
  activeBody: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  safeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  safeBtnPressed: { backgroundColor: '#f6d6d1' },
  safeBtnText: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.danger,
  },
});
