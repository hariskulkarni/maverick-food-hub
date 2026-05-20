/**
 * Delivery Preferences — how the rider wants dispatch to behave.
 *
 *   • Auto-accept   — a switch; accept matched orders without a tap.
 *   • Max batch     — a 1–3 stepper; how many orders to carry at once.
 *   • Notify radius — a chip-set of km values; how far out to ping for orders.
 *   • Preferred zones — a chip editor (type + add, tap to remove).
 *   • Break mode    — the embeddable <BreakModeCard />.
 *
 * Every change saves immediately via PATCH and is applied optimistically; if
 * the request fails the previous value is rolled back and an Alert is shown.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import {
  dispatch,
  type RiderPreferences,
  type PreferencesPatch,
} from '../lib/api-dispatch';
import { ApiError } from '../lib/api';
import { BreakModeCard } from '../components/break-mode-card';
import { ScreenHeader } from '../components/screen-header';

const RADIUS_OPTIONS = [2, 3, 5, 8, 12] as const;
const BATCH_MIN = 1;
const BATCH_MAX = 3;

export default function PreferencesScreen() {
  const [prefs, setPrefs] = useState<RiderPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoneDraft, setZoneDraft] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await dispatch.preferences();
      setPrefs(res.preferences);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your preferences.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  /**
   * Optimistic save: apply `optimistic` locally at once, fire the PATCH, and on
   * failure roll back to the value captured before the change.
   */
  const save = useCallback(
    async (patch: PreferencesPatch, optimistic: RiderPreferences) => {
      const previous = prefs;
      setPrefs(optimistic);
      setSaving(true);
      try {
        const res = await dispatch.updatePreferences(patch);
        setPrefs(res.preferences);
      } catch (e) {
        if (previous) setPrefs(previous);
        Alert.alert(
          'Could not save',
          e instanceof ApiError ? e.message : 'Your change was not saved. Please try again.'
        );
      } finally {
        setSaving(false);
      }
    },
    [prefs]
  );

  function setAutoAccept(value: boolean) {
    if (!prefs) return;
    save({ autoAccept: value }, { ...prefs, autoAccept: value });
  }

  function setBatch(next: number) {
    if (!prefs) return;
    const clamped = Math.min(BATCH_MAX, Math.max(BATCH_MIN, next));
    if (clamped === prefs.maxBatchSize) return;
    save({ maxBatchSize: clamped }, { ...prefs, maxBatchSize: clamped });
  }

  function setRadius(km: number) {
    if (!prefs || km === prefs.notifyRadiusKm) return;
    save({ notifyRadiusKm: km }, { ...prefs, notifyRadiusKm: km });
  }

  function addZone() {
    if (!prefs) return;
    const zone = zoneDraft.trim();
    if (!zone) return;
    if (prefs.preferredZones.some((z) => z.toLowerCase() === zone.toLowerCase())) {
      setZoneDraft('');
      return;
    }
    const next = [...prefs.preferredZones, zone];
    setZoneDraft('');
    save({ preferredZones: next }, { ...prefs, preferredZones: next });
  }

  function removeZone(zone: string) {
    if (!prefs) return;
    const next = prefs.preferredZones.filter((z) => z !== zone);
    save({ preferredZones: next }, { ...prefs, preferredZones: next });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader
        title="Delivery Preferences"
        right={saving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !prefs ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : prefs ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.headline}>Tune your dispatch</Text>
          <Text style={styles.subhead}>
            Changes save automatically and take effect on your next order.
          </Text>

          {/* Auto-accept */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={styles.rowText}>
                <Text style={styles.cardTitle}>Auto-accept orders</Text>
                <Text style={styles.cardBody}>
                  Skip the accept tap — matched orders go straight to your queue.
                </Text>
              </View>
              <Switch
                value={prefs.autoAccept}
                onValueChange={setAutoAccept}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            </View>
          </View>

          {/* Max batch size */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Max batch size</Text>
            <Text style={styles.cardBody}>
              How many orders you&apos;re willing to carry on one trip.
            </Text>
            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => setBatch(prefs.maxBatchSize - 1)}
                disabled={prefs.maxBatchSize <= BATCH_MIN}
                style={({ pressed }) => [
                  styles.stepperBtn,
                  pressed && styles.stepperBtnPressed,
                  prefs.maxBatchSize <= BATCH_MIN && styles.stepperBtnDisabled,
                ]}
              >
                <Ionicons name="remove" size={20} color={colors.text} />
              </Pressable>
              <View style={styles.stepperValue}>
                <Text style={styles.stepperValueText}>{prefs.maxBatchSize}</Text>
                <Text style={styles.stepperValueLabel}>
                  order{prefs.maxBatchSize === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable
                onPress={() => setBatch(prefs.maxBatchSize + 1)}
                disabled={prefs.maxBatchSize >= BATCH_MAX}
                style={({ pressed }) => [
                  styles.stepperBtn,
                  pressed && styles.stepperBtnPressed,
                  prefs.maxBatchSize >= BATCH_MAX && styles.stepperBtnDisabled,
                ]}
              >
                <Ionicons name="add" size={20} color={colors.text} />
              </Pressable>
            </View>
          </View>

          {/* Notify radius */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Notify radius</Text>
            <Text style={styles.cardBody}>
              Only ping me about orders within this distance.
            </Text>
            <View style={styles.chipWrap}>
              {RADIUS_OPTIONS.map((km) => {
                const active = km === prefs.notifyRadiusKm;
                return (
                  <Pressable
                    key={km}
                    onPress={() => setRadius(km)}
                    style={[styles.radiusChip, active && styles.radiusChipActive]}
                  >
                    <Text
                      style={[
                        styles.radiusChipText,
                        active && styles.radiusChipTextActive,
                      ]}
                    >
                      {km} km
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Preferred zones */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Preferred zones</Text>
            <Text style={styles.cardBody}>
              Areas you&apos;d rather work — dispatch favours orders here.
            </Text>
            {prefs.preferredZones.length > 0 ? (
              <View style={styles.chipWrap}>
                {prefs.preferredZones.map((zone) => (
                  <Pressable
                    key={zone}
                    onPress={() => removeZone(zone)}
                    style={styles.zoneChip}
                    accessibilityLabel={`Remove ${zone}`}
                  >
                    <Text style={styles.zoneChipText}>{zone}</Text>
                    <Ionicons name="close" size={14} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.zonesEmpty}>No zones added yet.</Text>
            )}
            <View style={styles.zoneInputRow}>
              <TextInput
                value={zoneDraft}
                onChangeText={setZoneDraft}
                onSubmitEditing={addZone}
                placeholder="Add a zone"
                placeholderTextColor={colors.textMuted}
                style={styles.zoneInput}
                maxLength={60}
                returnKeyType="done"
              />
              <Pressable
                onPress={addZone}
                disabled={!zoneDraft.trim()}
                style={({ pressed }) => [
                  styles.zoneAddBtn,
                  pressed && styles.zoneAddBtnPressed,
                  !zoneDraft.trim() && styles.btnDisabled,
                ]}
              >
                <Text style={styles.zoneAddText}>Add</Text>
              </Pressable>
            </View>
          </View>

          {/* Break mode */}
          <Text style={styles.sectionLabel}>Break mode</Text>
          <BreakModeCard preferences={prefs} onChange={setPrefs} />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },

  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  headline: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subhead: {
    marginTop: 2,
    marginBottom: spacing.xs,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 19,
  },

  errorText: {
    fontSize: font.size.sm,
    color: colors.danger,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: colors.white,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowText: { flex: 1 },
  cardTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  cardBody: {
    marginTop: 2,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 19,
  },

  stepperRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnPressed: { backgroundColor: colors.primarySoft },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperValue: { alignItems: 'center', minWidth: 64 },
  stepperValueText: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  stepperValueLabel: {
    fontSize: font.size.xs,
    color: colors.textMuted,
  },

  chipWrap: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  radiusChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  radiusChipText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  radiusChipTextActive: { color: colors.white },

  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  zoneChipText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.primary,
  },
  zonesEmpty: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  zoneInputRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  zoneInput: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: font.size.md,
    color: colors.text,
  },
  zoneAddBtn: {
    paddingHorizontal: spacing.lg,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneAddBtnPressed: { backgroundColor: colors.primaryDark },
  zoneAddText: {
    color: colors.white,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
  },
  btnDisabled: { opacity: 0.5 },

  sectionLabel: {
    marginTop: spacing.sm,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
});
