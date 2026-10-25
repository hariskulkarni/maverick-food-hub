/**
 * Payouts screen — request a withdrawal of your available balance to UPI or
 * bank, and track past requests.
 *
 * Wired to GET/POST /api/rider/payouts. A request is recorded as REQUESTED; the
 * Flavrly team makes the transfer and marks it PAID (or FAILED, which returns
 * the amount to the balance). Nothing is paid out automatically, so the copy
 * says "requested", never "instant", and each row shows its current status.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import {
  payments,
  type PayoutsResponse,
  type Payout,
  type PayoutMethod,
} from '../lib/api-payments';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '₹0';
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Rider-facing wording for each payout status. */
const PAYOUT_STATUS_LABEL: Record<Payout['status'], string> = {
  REQUESTED: 'Requested',
  PROCESSING: 'Processing',
  PAID: 'Paid',
  FAILED: 'Failed',
};

function statusStyle(status: Payout['status']): { bg: string; fg: string } {
  if (status === 'PAID') return { bg: colors.successSoft, fg: colors.success };
  if (status === 'FAILED') return { bg: colors.dangerSoft, fg: colors.danger };
  return { bg: '#fdf4e3', fg: colors.warning }; // REQUESTED / PROCESSING
}

export default function PayoutsScreen() {
  const [data, setData] = useState<PayoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [method, setMethod] = useState<PayoutMethod>('UPI');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await payments.payouts());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your payouts.');
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

  const available = data?.availableBalance ?? 0;

  function submitWithdrawal() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Enter an amount', 'Type how much you want to withdraw.');
      return;
    }
    if (amt > available) {
      Alert.alert('Amount too high', `You can withdraw up to ${rupees(available)} right now.`);
      return;
    }
    if (method === 'UPI' && !upiId.trim()) {
      Alert.alert('UPI ID needed', 'Enter the UPI ID you want the money sent to.');
      return;
    }

    const dest = method === 'UPI' ? upiId.trim() : 'your bank account';
    Alert.alert(
      'Confirm withdrawal',
      `Request ${rupees(amt)} to ${dest}? The Flavrly team processes withdrawal requests and transfers the money; you can track the status below.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request',
          style: 'default',
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await payments.requestPayout(
                amt,
                method,
                method === 'UPI' ? upiId.trim() : undefined
              );
              setAmount('');
              setUpiId('');
              await load();
              Alert.alert(
                'Withdrawal requested',
                `Your request for ${rupees(res.payout.amount)} is recorded (status: ${PAYOUT_STATUS_LABEL[res.payout.status] ?? res.payout.status}). The Flavrly team will process it and the status will change to Paid once the money is sent.`
              );
            } catch (e) {
              Alert.alert(
                'Request failed',
                e instanceof ApiError ? e.message : 'Please try again in a moment.'
              );
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Payouts" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          >
            {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

            {/* Balance hero */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>AVAILABLE TO WITHDRAW</Text>
              <Text style={styles.heroAmount}>{rupees(available)}</Text>
              <View style={styles.heroMetaRow}>
                <Text style={styles.heroMeta}>
                  Lifetime {rupees(data?.lifetimeEarnings ?? 0)}
                </Text>
                <View style={styles.heroDot} />
                <Text style={styles.heroMeta}>
                  Paid out {rupees(data?.totalPaidOut ?? 0)}
                </Text>
              </View>
            </View>

            {/* Withdraw form */}
            <Text style={styles.sectionLabel}>REQUEST A WITHDRAWAL</Text>
            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>Amount</Text>
              <View style={styles.amountRow}>
                <Text style={styles.rupeeSign}>₹</Text>
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={7}
                />
                <Pressable
                  style={styles.maxBtn}
                  onPress={() => setAmount(String(Math.floor(available)))}
                  hitSlop={6}
                >
                  <Text style={styles.maxBtnText}>MAX</Text>
                </Pressable>
              </View>

              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Pay to</Text>
              <View style={styles.methodRow}>
                {(['UPI', 'BANK'] as PayoutMethod[]).map((m) => {
                  const active = method === m;
                  return (
                    <Pressable
                      key={m}
                      style={[styles.methodChip, active && styles.methodChipActive]}
                      onPress={() => setMethod(m)}
                    >
                      <Ionicons
                        name={m === 'UPI' ? 'flash-outline' : 'business-outline'}
                        size={16}
                        color={active ? colors.white : colors.textMuted}
                      />
                      <Text
                        style={[styles.methodChipText, active && styles.methodChipTextActive]}
                      >
                        {m === 'UPI' ? 'UPI' : 'Bank account'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {method === 'UPI' ? (
                <>
                  <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>UPI ID</Text>
                  <TextInput
                    style={styles.textInput}
                    value={upiId}
                    onChangeText={setUpiId}
                    placeholder="yourname@upi"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                  />
                </>
              ) : (
                <Text style={styles.bankNote}>
                  Money will be sent to the bank account on file with Flavrly.
                </Text>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  pressed && styles.submitBtnPressed,
                  (submitting || available <= 0) && styles.submitBtnDisabled,
                ]}
                onPress={submitWithdrawal}
                disabled={submitting || available <= 0}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {available <= 0 ? 'Nothing to withdraw yet' : 'Request withdrawal'}
                  </Text>
                )}
              </Pressable>
            </View>

            {/* History */}
            <Text style={styles.sectionLabel}>PAYOUT HISTORY</Text>
            {(data?.payouts.length ?? 0) === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="receipt-outline" size={28} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  No withdrawal requests yet. Requests you make appear here with their status.
                </Text>
              </View>
            ) : (
              <View style={styles.historyList}>
                {data!.payouts.map((p) => {
                  const sc = statusStyle(p.status);
                  return (
                    <View key={p.id} style={styles.historyRow}>
                      <View style={styles.historyLeft}>
                        <Text style={styles.historyAmount}>{rupees(p.amount)}</Text>
                        <Text style={styles.historyMeta}>
                          {p.method === 'UPI' ? p.upiId ?? 'UPI' : 'Bank account'}
                        </Text>
                        <Text style={styles.historyDate}>{fmtWhen(p.requestedAt)}</Text>
                        {p.reference ? (
                          <Text style={styles.historyRef}>Ref {p.reference}</Text>
                        ) : null}
                      </View>
                      <View style={[styles.statusChip, { backgroundColor: sc.bg }]}>
                        <Text style={[styles.statusChipText, { color: sc.fg }]}>
                          {PAYOUT_STATUS_LABEL[p.status] ?? p.status}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.white,
    opacity: 0.85,
    letterSpacing: 1.5,
  },
  heroAmount: {
    fontSize: 40,
    fontWeight: font.weight.bold,
    color: colors.white,
    marginTop: spacing.xs,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  heroMeta: { fontSize: font.size.sm, color: colors.white, opacity: 0.9 },
  heroDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.white,
    opacity: 0.7,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },

  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  fieldLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  fieldLabelSpaced: { marginTop: spacing.lg },

  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: colors.primary,
    marginTop: spacing.xs,
    paddingBottom: 2,
  },
  rupeeSign: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    padding: 0,
  },
  maxBtn: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  maxBtnText: {
    fontSize: 11,
    fontWeight: font.weight.bold,
    color: colors.primary,
    letterSpacing: 0.5,
  },

  methodRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  methodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  methodChipText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
  },
  methodChipTextActive: { color: colors.white },

  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: font.size.md,
    color: colors.text,
    marginTop: spacing.xs,
    backgroundColor: colors.bg,
  },
  bankNote: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 19,
  },

  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    ...shadow.card,
  },
  submitBtnPressed: { backgroundColor: colors.primaryDark },
  submitBtnDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  submitBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },

  historyList: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyLeft: { flex: 1 },
  historyAmount: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  historyMeta: { fontSize: font.size.sm, color: colors.textMuted, marginTop: 1 },
  historyDate: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 1 },
  historyRef: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 1 },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusChipText: { fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.5 },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },
});
