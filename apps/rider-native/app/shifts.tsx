/**
 * My Shifts — book and manage work slots.
 *
 * Riders reserve high-demand windows in advance. This screen lists upcoming
 * shifts with status chips, lets a rider start / complete / cancel them, and
 * offers a lightweight "Book a slot" form: a row of upcoming-day chips, two
 * "HH:MM" time chips, and an optional free-text zone — no native date picker,
 * so no new dependency.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import {
  dispatch,
  type Shift,
  type ShiftStatus,
} from '../lib/api-dispatch';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
/** Selectable start/end times offered by the booking form. */
const TIME_SLOTS = [
  '08:00', '10:00', '12:00', '14:00',
  '16:00', '18:00', '20:00', '22:00',
];

/** "YYYY-MM-DD" for a Date, in local time. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The next 7 calendar days starting today, for the day-chip picker. */
function upcomingDays(): { key: string; label: string; sub: string }[] {
  const out: { key: string; label: string; sub: string }[] = [];
  const base = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      key: ymd(d),
      label: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : DAY_NAMES[d.getDay()],
      sub: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`,
    });
  }
  return out;
}

function prettyDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

const STATUS_CHIP: Record<ShiftStatus, { bg: string; fg: string; label: string }> = {
  BOOKED: { bg: colors.primarySoft, fg: colors.primary, label: 'Booked' },
  STARTED: { bg: colors.successSoft, fg: colors.success, label: 'In progress' },
  COMPLETED: { bg: colors.bg, fg: colors.textMuted, label: 'Completed' },
  MISSED: { bg: colors.dangerSoft, fg: colors.danger, label: 'Missed' },
  CANCELLED: { bg: colors.bg, fg: colors.textMuted, label: 'Cancelled' },
};

// ─── Shift card ──────────────────────────────────────────────────────────────

function ShiftCard({
  shift,
  busy,
  onStart,
  onComplete,
  onCancel,
}: {
  shift: Shift;
  busy: boolean;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const chip = STATUS_CHIP[shift.status];
  return (
    <View style={styles.shiftCard}>
      <View style={styles.shiftHead}>
        <View style={styles.shiftHeadText}>
          <Text style={styles.shiftDate}>{prettyDate(shift.date)}</Text>
          <Text style={styles.shiftTime}>
            {shift.startTime} – {shift.endTime}
            {shift.zoneName ? ` · ${shift.zoneName}` : ''}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: chip.bg }]}>
          <Text style={[styles.chipText, { color: chip.fg }]}>{chip.label}</Text>
        </View>
      </View>

      {shift.status === 'BOOKED' || shift.status === 'STARTED' ? (
        <View style={styles.shiftActions}>
          {shift.status === 'BOOKED' ? (
            <>
              <Pressable
                onPress={onStart}
                disabled={busy}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionPrimary,
                  pressed && styles.actionPrimaryPressed,
                  busy && styles.btnDisabled,
                ]}
              >
                <Text style={styles.actionPrimaryText}>Start shift</Text>
              </Pressable>
              <Pressable
                onPress={onCancel}
                disabled={busy}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionGhost,
                  pressed && styles.actionGhostPressed,
                  busy && styles.btnDisabled,
                ]}
              >
                <Text style={styles.actionGhostText}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={onComplete}
              disabled={busy}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionPrimary,
                pressed && styles.actionPrimaryPressed,
                busy && styles.btnDisabled,
              ]}
            >
              <Text style={styles.actionPrimaryText}>Complete shift</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ─── Booking form ────────────────────────────────────────────────────────────

function BookingForm({
  onBooked,
}: {
  onBooked: (shift: Shift) => void;
}) {
  const days = useMemo(() => upcomingDays(), []);
  const [date, setDate] = useState(days[0].key);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('14:00');
  const [zone, setZone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const valid = endTime > startTime;

  async function submit() {
    if (!valid) {
      Alert.alert('Check the times', 'End time must be after start time.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await dispatch.bookShift({
        date,
        startTime,
        endTime,
        zoneName: zone.trim() || null,
      });
      onBooked(res.shift);
      setZone('');
      Alert.alert('Slot booked', 'Your shift is on the calendar.');
    } catch (e) {
      Alert.alert(
        'Could not book',
        e instanceof ApiError ? e.message : 'Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>Book a slot</Text>

      <Text style={styles.fieldLabel}>Day</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
      >
        {days.map((d) => {
          const active = d.key === date;
          return (
            <Pressable
              key={d.key}
              onPress={() => setDate(d.key)}
              style={[styles.dayChip, active && styles.dayChipActive]}
            >
              <Text style={[styles.dayChipLabel, active && styles.dayChipTextActive]}>
                {d.label}
              </Text>
              <Text style={[styles.dayChipSub, active && styles.dayChipTextActive]}>
                {d.sub}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.fieldLabel}>Start time</Text>
      <View style={styles.timeWrap}>
        {TIME_SLOTS.map((t) => {
          const active = t === startTime;
          return (
            <Pressable
              key={`s-${t}`}
              onPress={() => setStartTime(t)}
              style={[styles.timeChip, active && styles.timeChipActive]}
            >
              <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                {t}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>End time</Text>
      <View style={styles.timeWrap}>
        {TIME_SLOTS.map((t) => {
          const active = t === endTime;
          const disabled = t <= startTime;
          return (
            <Pressable
              key={`e-${t}`}
              onPress={() => !disabled && setEndTime(t)}
              disabled={disabled}
              style={[
                styles.timeChip,
                active && styles.timeChipActive,
                disabled && styles.timeChipDisabled,
              ]}
            >
              <Text
                style={[
                  styles.timeChipText,
                  active && styles.timeChipTextActive,
                  disabled && styles.timeChipTextDisabled,
                ]}
              >
                {t}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>Preferred zone (optional)</Text>
      <TextInput
        value={zone}
        onChangeText={setZone}
        placeholder="e.g. Koramangala"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={60}
      />

      <Pressable
        onPress={submit}
        disabled={submitting || !valid}
        style={({ pressed }) => [
          styles.bookBtn,
          pressed && styles.bookBtnPressed,
          (submitting || !valid) && styles.btnDisabled,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.bookBtnText}>Book this slot</Text>
        )}
      </Pressable>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ShiftsScreen() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await dispatch.shifts();
      setShifts(res.shifts);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your shifts.');
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  function onBooked(shift: Shift) {
    setShifts((prev) =>
      [...prev, shift].sort((a, b) =>
        a.date === b.date
          ? a.startTime.localeCompare(b.startTime)
          : a.date.localeCompare(b.date)
      )
    );
  }

  async function transition(shift: Shift, status: ShiftStatus) {
    if (busyId) return;
    setBusyId(shift.id);
    try {
      const res = await dispatch.updateShift(shift.id, status);
      setShifts((prev) => prev.map((s) => (s.id === shift.id ? res.shift : s)));
    } catch (e) {
      Alert.alert(
        'Could not update shift',
        e instanceof ApiError ? e.message : 'Please try again.'
      );
    } finally {
      setBusyId(null);
    }
  }

  function confirmCancel(shift: Shift) {
    Alert.alert(
      'Cancel this shift?',
      `${prettyDate(shift.date)}, ${shift.startTime}–${shift.endTime} will be removed.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel shift',
          style: 'destructive',
          onPress: async () => {
            if (busyId) return;
            setBusyId(shift.id);
            try {
              await dispatch.cancelShift(shift.id);
              setShifts((prev) => prev.filter((s) => s.id !== shift.id));
            } catch (e) {
              Alert.alert(
                'Could not cancel',
                e instanceof ApiError ? e.message : 'Please try again.'
              );
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="My Shifts" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <Text style={styles.headline}>Plan your week</Text>
          <Text style={styles.subhead}>
            Reserve busy windows in advance — booked riders get first pick of the
            pool.
          </Text>

          {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming shifts</Text>
            {shifts.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No shifts booked</Text>
                <Text style={styles.emptyBody}>
                  Book a slot below to lock in a work window. Your upcoming shifts
                  will show up here.
                </Text>
              </View>
            ) : (
              <View style={styles.shiftList}>
                {shifts.map((s) => (
                  <ShiftCard
                    key={s.id}
                    shift={s}
                    busy={busyId === s.id}
                    onStart={() => transition(s, 'STARTED')}
                    onComplete={() => transition(s, 'COMPLETED')}
                    onCancel={() => confirmCancel(s)}
                  />
                ))}
              </View>
            )}
          </View>

          <BookingForm onBooked={onBooked} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  headline: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subhead: {
    marginTop: 2,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 19,
  },

  errorBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },

  section: { marginTop: spacing.lg },
  sectionTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },

  shiftList: { gap: spacing.md },
  shiftCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  shiftHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  shiftHeadText: { flex: 1, marginRight: spacing.md },
  shiftDate: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  shiftTime: {
    marginTop: 2,
    fontSize: font.size.sm,
    color: colors.textMuted,
  },
  shiftActions: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionPrimaryPressed: { backgroundColor: colors.primaryDark },
  actionPrimaryText: {
    color: colors.white,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
  },
  actionGhost: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionGhostPressed: { backgroundColor: colors.bg },
  actionGhostText: {
    color: colors.text,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },

  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 0.3,
  },

  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    marginTop: spacing.md,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  emptyBody: {
    marginTop: spacing.xs,
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  formCard: {
    marginTop: spacing.xl,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  formTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  fieldLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },

  chipScroll: { gap: spacing.sm, paddingRight: spacing.sm },
  dayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    minWidth: 64,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayChipLabel: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  dayChipSub: {
    marginTop: 1,
    fontSize: font.size.xs,
    color: colors.textMuted,
  },
  dayChipTextActive: { color: colors.white },

  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  timeChipDisabled: { opacity: 0.4 },
  timeChipText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  timeChipTextActive: { color: colors.white },
  timeChipTextDisabled: { color: colors.textMuted },

  input: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: font.size.md,
    color: colors.text,
  },

  bookBtn: {
    marginTop: spacing.lg,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookBtnPressed: { backgroundColor: colors.primaryDark },
  bookBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  btnDisabled: { opacity: 0.6 },
});
