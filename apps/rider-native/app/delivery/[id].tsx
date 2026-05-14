/**
 * Active delivery — the multi-step hand-off state machine.
 *
 * The backend's `reach-restaurant` / `reach-customer` calls only stamp markers
 * in the assignment's `notes` field (status stays ACCEPTED / PICKED_UP), so we
 * derive the current sub-step from status + notes together:
 *
 *   PENDING                                  → accept
 *   ACCEPTED, no  [reached-restaurant]        → to_restaurant
 *   ACCEPTED, has [reached-restaurant]        → at_restaurant
 *   PICKED_UP, no  [reached-customer]         → to_customer
 *   PICKED_UP, has [reached-customer]         → at_customer
 *   DELIVERED                                 → delivered
 *
 * Full-screen (pushed over the tab bar) so the rider stays focused on the job.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, type Assignment } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useRiderLocation } from '../../lib/use-rider-location';
import { DeliveryMap } from '../../components/delivery-map';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

type Step =
  | 'accept'
  | 'to_restaurant'
  | 'at_restaurant'
  | 'to_customer'
  | 'at_customer'
  | 'delivered';

const MILESTONES = ['Reach restaurant', 'Pick up order', 'Reach customer', 'Hand over'];

function deriveStep(a: Assignment): Step {
  if (a.status === 'DELIVERED') return 'delivered';
  if (a.status === 'PENDING') return 'accept';
  const notes = a.notes ?? '';
  if (a.status === 'PICKED_UP') {
    return notes.includes('[reached-customer') ? 'at_customer' : 'to_customer';
  }
  // ACCEPTED
  return notes.includes('[reached-restaurant') ? 'at_restaurant' : 'to_restaurant';
}

function milestoneIndex(step: Step): number {
  switch (step) {
    case 'accept':
    case 'to_restaurant':
      return 0;
    case 'at_restaurant':
      return 1;
    case 'to_customer':
      return 2;
    case 'at_customer':
      return 3;
    case 'delivered':
      return 4;
  }
}

function rupees(s: string): string {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Stepper({ activeIndex }: { activeIndex: number }) {
  return (
    <View style={styles.stepper}>
      {MILESTONES.map((label, i) => {
        const done = i < activeIndex;
        const current = i === activeIndex;
        return (
          <View key={label} style={styles.stepRow}>
            <View style={styles.stepRail}>
              <View
                style={[
                  styles.stepDot,
                  done && styles.stepDotDone,
                  current && styles.stepDotCurrent,
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" size={12} color={colors.white} />
                ) : (
                  <Text style={[styles.stepNum, current && styles.stepNumCurrent]}>
                    {i + 1}
                  </Text>
                )}
              </View>
              {i < MILESTONES.length - 1 ? (
                <View style={[styles.stepLine, done && styles.stepLineDone]} />
              ) : null}
            </View>
            <Text
              style={[
                styles.stepLabel,
                done && styles.stepLabelDone,
                current && styles.stepLabelCurrent,
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function RouteBlock({ a }: { a: Assignment }) {
  const o = a.order;
  const drop = o.address
    ? [o.address.line1, o.address.line2, o.address.city].filter(Boolean).join(', ')
    : 'Customer address';
  const phone = o.customer?.phone ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.routeNode}>
        <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
        <View style={styles.routeBody}>
          <Text style={styles.routeLabel}>PICKUP</Text>
          <Text style={styles.routeValue}>{o.branch?.name ?? 'Restaurant'}</Text>
        </View>
      </View>
      <View style={styles.routeConnector} />
      <View style={styles.routeNode}>
        <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
        <View style={styles.routeBody}>
          <Text style={styles.routeLabel}>DROP</Text>
          <Text style={styles.routeValue}>{drop}</Text>
          {o.customer?.name ? (
            <Text style={styles.routeSub}>{o.customer.name}</Text>
          ) : null}
        </View>
        {phone ? (
          <Pressable
            style={styles.callBtn}
            onPress={() => Linking.openURL(`tel:${phone}`)}
            hitSlop={8}
          >
            <Ionicons name="call" size={18} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.assignments();
      const found = list.find((a) => a.id === id);
      if (found) {
        setAssignment(found);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  // Stream GPS while this delivery is live — feeds the in-app map and the
  // customer / admin trackers. Stops automatically once delivered.
  const { position: riderPos, permissionDenied } = useRiderLocation({
    orderId: assignment?.orderId ?? null,
    enabled: !!assignment && !delivered && assignment.status !== 'DELIVERED',
  });

  // Auth guard (this screen lives outside the (app) group's guard).
  if (authLoading) return null;
  if (!token) return <Redirect href="/login" />;

  // ── Action runners ────────────────────────────────────────────────────────
  async function runStep(fn: () => Promise<unknown>) {
    if (acting) return;
    setActing(true);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('Could not update', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setActing(false);
    }
  }

  async function confirmDelivery() {
    if (acting || !assignment) return;
    if (otp.length < 4) {
      setOtpError('Enter the code the customer gives you.');
      return;
    }
    setActing(true);
    setOtpError(null);
    try {
      await api.deliver(assignment.id, otp);
      setDelivered(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setOtpError('That code is incorrect. Ask the customer to read it again.');
      } else {
        Alert.alert('Could not confirm', e instanceof ApiError ? e.message : 'Please try again.');
      }
    } finally {
      setActing(false);
    }
  }

  // ── Render states ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (delivered) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={48} color={colors.white} />
          </View>
          <Text style={styles.successTitle}>Delivered!</Text>
          <Text style={styles.successBody}>
            Nice work. Your earnings have been added.
          </Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.primaryBtnText}>Back to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (notFound || !assignment) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="cube-outline" size={40} color={colors.textMuted} />
          <Text style={styles.successTitle}>Not an active delivery</Text>
          <Text style={styles.successBody}>
            This delivery is no longer in progress.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.replace('/')}>
            <Text style={styles.primaryBtnText}>Back to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const step = deriveStep(assignment);
  const idx = milestoneIndex(step);
  const o = assignment.order;
  const itemCount = o.items.reduce((s, it) => s + (it.quantity ?? 1), 0);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerCode}>{o.code}</Text>
            <Text style={styles.headerSub}>
              {itemCount} item{itemCount === 1 ? '' : 's'} · {rupees(o.total)}
            </Text>
          </View>
          <View style={styles.earnPill}>
            <Text style={styles.earnText}>{rupees(assignment.earningsAmt)}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <DeliveryMap
            pickup={
              o.branch?.latitude != null && o.branch?.longitude != null
                ? { lat: o.branch.latitude, lng: o.branch.longitude }
                : null
            }
            drop={
              o.address?.latitude != null && o.address?.longitude != null
                ? { lat: o.address.latitude, lng: o.address.longitude }
                : null
            }
            rider={riderPos}
          />
          {permissionDenied ? (
            <Text style={styles.permWarning}>
              Location permission is off — your live position won't show on the
              customer's tracker. Enable it in your phone's settings.
            </Text>
          ) : null}
          <Stepper activeIndex={idx} />
          <RouteBlock a={assignment} />

          {o.customerNotes ? (
            <View style={styles.notesCard}>
              <Text style={styles.notesLabel}>CUSTOMER NOTE</Text>
              <Text style={styles.notesText}>{o.customerNotes}</Text>
            </View>
          ) : null}

          {/* Final step: OTP entry */}
          {step === 'at_customer' ? (
            <View style={styles.otpBlock}>
              <Text style={styles.otpTitle}>Confirm hand-over</Text>
              <Text style={styles.otpHint}>
                Ask the customer for their delivery code and enter it below.
              </Text>
              {o.deliveryOtp ? (
                <View style={styles.demoHint}>
                  <Text style={styles.demoHintLabel}>DEMO MODE</Text>
                  <Text style={styles.demoHintText}>
                    The customer's code is{' '}
                    <Text style={styles.demoHintCode}>{o.deliveryOtp}</Text>
                  </Text>
                </View>
              ) : null}
              <TextInput
                style={[styles.otpInput, otpError ? styles.otpInputError : null]}
                value={otp}
                onChangeText={(t) => {
                  setOtp(t.replace(/[^0-9]/g, '').slice(0, 6));
                  if (otpError) setOtpError(null);
                }}
                placeholder="••••"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
              />
              {otpError ? <Text style={styles.otpErrorText}>{otpError}</Text> : null}
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky action button */}
        <View style={styles.actionBar}>
          {step === 'accept' ? (
            <ActionButton
              label="Accept this delivery"
              acting={acting}
              onPress={() => runStep(() => api.acceptAssignment(assignment.id))}
            />
          ) : step === 'to_restaurant' ? (
            <ActionButton
              label="I've reached the restaurant"
              acting={acting}
              onPress={() => runStep(() => api.reachRestaurant(assignment.id))}
            />
          ) : step === 'at_restaurant' ? (
            <ActionButton
              label="I've picked up the order"
              acting={acting}
              onPress={() => runStep(() => api.pickup(assignment.id))}
            />
          ) : step === 'to_customer' ? (
            <ActionButton
              label="I've reached the customer"
              acting={acting}
              onPress={() => runStep(() => api.reachCustomer(assignment.id))}
            />
          ) : step === 'at_customer' ? (
            <ActionButton
              label="Confirm delivery"
              acting={acting}
              onPress={confirmDelivery}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  acting,
  onPress,
}: {
  label: string;
  acting: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={acting}
      style={({ pressed }) => [
        styles.primaryBtn,
        styles.actionBtn,
        pressed && !acting && styles.primaryBtnPressed,
        acting && styles.primaryBtnDisabled,
      ]}
    >
      {acting ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerCenter: { flex: 1 },
  headerCode: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  headerSub: { fontSize: font.size.sm, color: colors.textMuted },
  earnPill: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  earnText: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.success,
  },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  // Stepper
  stepper: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  stepRail: { alignItems: 'center', width: 28 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepDotCurrent: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  stepNum: { fontSize: font.size.xs, fontWeight: font.weight.bold, color: colors.textMuted },
  stepNumCurrent: { color: colors.primary },
  stepLine: { width: 2, height: 28, backgroundColor: colors.border },
  stepLineDone: { backgroundColor: colors.success },
  stepLabel: {
    flex: 1,
    fontSize: font.size.md,
    color: colors.textMuted,
    marginLeft: spacing.md,
    paddingTop: 2,
  },
  stepLabelDone: { color: colors.text },
  stepLabelCurrent: { color: colors.text, fontWeight: font.weight.bold },

  // Cards
  card: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  routeNode: { flexDirection: 'row', alignItems: 'flex-start' },
  routeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: spacing.md },
  routeBody: { flex: 1 },
  routeLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  routeValue: {
    fontSize: font.size.md,
    color: colors.text,
    fontWeight: font.weight.medium,
    marginTop: 1,
  },
  routeSub: { fontSize: font.size.sm, color: colors.textMuted, marginTop: 1 },
  routeConnector: {
    width: 2,
    height: 18,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: 2,
  },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  notesCard: {
    marginTop: spacing.md,
    backgroundColor: '#fdf4e3',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#f0e0bf',
  },
  notesLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.warning,
    letterSpacing: 1,
    marginBottom: 2,
  },
  notesText: { fontSize: font.size.sm, color: colors.text, lineHeight: 20 },

  // OTP
  otpBlock: { marginTop: spacing.lg },
  otpTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  otpHint: {
    marginTop: spacing.xs,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
  demoHint: {
    marginTop: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  demoHintLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.primary,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  demoHintText: { fontSize: font.size.sm, color: colors.text },
  demoHintCode: { fontWeight: font.weight.bold, color: colors.primaryDark },
  otpInput: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 60,
    fontSize: 26,
    letterSpacing: 10,
    textAlign: 'center',
    color: colors.text,
    fontWeight: font.weight.semibold,
  },
  otpInputError: { borderColor: colors.danger },
  otpErrorText: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontSize: font.size.sm,
  },

  // Action bar
  actionBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  primaryBtn: {
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    ...shadow.card,
  },
  actionBtn: { marginTop: 0 },
  primaryBtnPressed: { backgroundColor: colors.primaryDark },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },

  // Success / not-found
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successTitle: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  successBody: {
    marginTop: spacing.sm,
    fontSize: font.size.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
  },
  permWarning: {
    backgroundColor: '#fdf4e3',
    borderWidth: 1,
    borderColor: '#f0e0bf',
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 18,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
});
