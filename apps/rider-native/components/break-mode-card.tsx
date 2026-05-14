/**
 * Break-mode card — an embeddable control for the rider's "on a break" state.
 *
 * Off  → a "Take a break" button that reveals 15 / 30 / 60-minute chips; picking
 *        one flips breakMode on with a breakUntil timestamp that far ahead.
 * On   → "On break until HH:MM" with the minutes remaining and an
 *        "End break now" button that clears the break.
 *
 * Self-contained and reusable: pass `preferences` + `onChange` to have a parent
 * (e.g. the Preferences screen) own the state, or omit both and the card will
 * self-fetch on mount — handy for dropping straight onto the Home screen.
 */
import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { dispatch, type RiderPreferences } from '../lib/api-dispatch';
import { ApiError } from '../lib/api';

const DURATIONS = [15, 30, 60] as const;

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function minutesLeft(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.round((d.getTime() - Date.now()) / 60000));
}

export function BreakModeCard({
  preferences,
  onChange,
}: {
  /** Controlled mode — when supplied, the parent owns preferences state. */
  preferences?: RiderPreferences | null;
  onChange?: (prefs: RiderPreferences) => void;
}) {
  const controlled = preferences !== undefined;
  const [selfPrefs, setSelfPrefs] = useState<RiderPreferences | null>(null);
  const [loading, setLoading] = useState(!controlled);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Re-render every 30s so the "minutes left" countdown stays fresh.
  const [, setTick] = useState(0);

  const prefs = controlled ? preferences : selfPrefs;

  // Self-fetch when uncontrolled.
  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await dispatch.preferences();
        if (!cancelled) setSelfPrefs(res.preferences);
      } catch {
        // Stay silent — the card just won't render until prefs load.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controlled]);

  // Countdown ticker — only while a break is active.
  useEffect(() => {
    if (!prefs?.breakMode) return;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [prefs?.breakMode]);

  const apply = useCallback(
    async (patch: { breakMode: boolean; breakUntil: string | null }) => {
      setSaving(true);
      try {
        const res = await dispatch.updatePreferences(patch);
        if (controlled) {
          onChange?.(res.preferences);
        } else {
          setSelfPrefs(res.preferences);
        }
        setPicking(false);
      } catch (e) {
        Alert.alert(
          'Could not update break',
          e instanceof ApiError ? e.message : 'Please try again.'
        );
      } finally {
        setSaving(false);
      }
    },
    [controlled, onChange]
  );

  function startBreak(mins: number) {
    const until = new Date(Date.now() + mins * 60000).toISOString();
    apply({ breakMode: true, breakUntil: until });
  }

  function endBreak() {
    apply({ breakMode: false, breakUntil: null });
  }

  if (loading) {
    return (
      <View style={[styles.card, styles.cardLoading]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={styles.card}>
        <Text style={styles.unavailable}>Break mode is unavailable right now.</Text>
      </View>
    );
  }

  // ── On break ───────────────────────────────────────────────────────────────
  if (prefs.breakMode) {
    const left = prefs.breakUntil ? minutesLeft(prefs.breakUntil) : 0;
    return (
      <View style={[styles.card, styles.cardOnBreak]}>
        <View style={styles.headRow}>
          <View style={styles.iconBubbleWarn}>
            <Ionicons name="pause" size={18} color={colors.warning} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.title}>On a break</Text>
            <Text style={styles.subtitle}>
              {prefs.breakUntil
                ? `Until ${formatClock(prefs.breakUntil)} · ${left} min left`
                : 'No end time set'}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={endBreak}
          disabled={saving}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && styles.primaryBtnPressed,
            saving && styles.btnDisabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryBtnText}>End break now</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // ── Not on break ───────────────────────────────────────────────────────────
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.iconBubble}>
          <Ionicons name="cafe-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Take a break</Text>
          <Text style={styles.subtitle}>
            Pause new-order pings without going fully offline.
          </Text>
        </View>
      </View>

      {picking ? (
        <>
          <View style={styles.chipRow}>
            {DURATIONS.map((mins) => (
              <Pressable
                key={mins}
                onPress={() => startBreak(mins)}
                disabled={saving}
                style={({ pressed }) => [
                  styles.durationChip,
                  pressed && styles.durationChipPressed,
                  saving && styles.btnDisabled,
                ]}
              >
                <Text style={styles.durationChipText}>{mins} min</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setPicking(false)} disabled={saving} hitSlop={8}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
        >
          <Text style={styles.primaryBtnText}>Take a break</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  cardLoading: { alignItems: 'center', justifyContent: 'center', minHeight: 96 },
  cardOnBreak: { borderColor: colors.warning, backgroundColor: '#fdf4e3' },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBubbleWarn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1 },
  title: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subtitle: {
    marginTop: 1,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  unavailable: {
    fontSize: font.size.sm,
    color: colors.textMuted,
  },

  chipRow: { flexDirection: 'row', gap: spacing.sm },
  durationChip: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationChipPressed: { backgroundColor: colors.primary },
  durationChipText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.primary,
  },
  cancelLink: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    fontWeight: font.weight.medium,
    textAlign: 'center',
  },

  primaryBtn: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: { backgroundColor: colors.primaryDark },
  primaryBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  btnDisabled: { opacity: 0.6 },
});
