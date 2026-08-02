/**
 * Digital collection for a cash-on-delivery order.
 *
 * A large share of doorstep "cash" orders end with the customer wanting to pay
 * by UPI. Without this the rider either refuses, or takes the money into some
 * personal account and still owes Flavrly cash. This card lets them take it
 * properly: tap, hand over the phone (or show the UPI QR), and the amount stops
 * counting against their cash-in-hand the moment PhonePe confirms.
 *
 * Deliberately NOT the PhonePe mobile SDK. It opens the same PayPage URL the
 * web checkout uses, in an in-app browser, so a rider-collected payment lands
 * in exactly the same capture path (webhook → status API → reconcile) as a
 * customer-collected one. One code path, one set of guarantees, no native
 * module to keep in sync across Expo upgrades.
 *
 * Trust boundary: this component never sends an amount. The backend charges the
 * order total and confirms server-to-server with PhonePe. "Browser closed" is
 * treated as "unknown", never as "paid" — only our server can say that.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { payments } from '../lib/api-payments';
import { ApiError } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

type Phase = 'idle' | 'opening' | 'waiting' | 'paid' | 'failed';

/** Fast at first, then backing off — most UPI intent payments settle in seconds. */
const POLL_SCHEDULE_MS = [1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000];
const MAX_POLL_MS = 4 * 60_000;

interface Props {
  assignmentId: string;
  /** Order total, for the button label. */
  amount: number;
  /** Fired once the payment is confirmed captured, so the parent can refresh. */
  onCollected?: () => void;
}

export function CollectOnlineCard({ assignmentId, amount, onCollected }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const poll = useCallback(
    (startedAt: number, attempt: number) => {
      if (!mounted.current) return;
      payments
        .digitalCollectionStatus(assignmentId)
        .then((res) => {
          if (!mounted.current) return;
          if (res.state === 'COMPLETED') {
            setPhase('paid');
            onCollected?.();
            return;
          }
          // `indeterminate` = we could not reach PhonePe. Not a failure —
          // never tell a rider a payment failed when we don't actually know.
          if (res.state === 'FAILED' && !res.indeterminate) {
            setPhase('failed');
            setError(res.error ?? 'The payment did not go through.');
            return;
          }
          schedule(startedAt, attempt + 1);
        })
        .catch(() => {
          // Network blip on our own API — keep waiting.
          schedule(startedAt, attempt + 1);
        });

      function schedule(started: number, next: number) {
        if (!mounted.current) return;
        if (Date.now() - started > MAX_POLL_MS) {
          setPhase('failed');
          setError('Still not confirmed. Collect cash instead, or try again.');
          return;
        }
        const delay = POLL_SCHEDULE_MS[Math.min(next, POLL_SCHEDULE_MS.length - 1)];
        pollTimer.current = setTimeout(() => poll(started, next), delay);
      }
    },
    [assignmentId, onCollected],
  );

  const start = useCallback(async () => {
    setPhase('opening');
    setError(null);
    try {
      const session = await payments.startDigitalCollection(assignmentId);
      const url = session.payment?.redirectUrl;
      if (!url) throw new Error('The payment gateway did not return a checkout link.');

      setPhase('waiting');
      // Blocks until the rider dismisses the browser. Whatever it returns is a
      // UI hint only — the server decides whether money moved.
      await WebBrowser.openBrowserAsync(url, { showTitle: true, enableBarCollapsing: true });
      if (!mounted.current) return;
      poll(Date.now(), 0);
    } catch (e) {
      if (!mounted.current) return;
      setPhase('failed');
      const msg =
        e instanceof ApiError ? e.message : (e as Error).message || 'Could not start the payment.';
      setError(msg);
    }
  }, [assignmentId, poll]);

  const confirmStart = useCallback(() => {
    Alert.alert(
      'Collect digitally?',
      `The customer pays ₹${amount.toFixed(2)} by UPI or card on your phone. Don't take cash as well.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open payment page', onPress: start },
      ],
    );
  }, [amount, start]);

  if (phase === 'paid') {
    return (
      <View style={[styles.card, styles.cardPaid]}>
        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
        <View style={styles.body}>
          <Text style={styles.titlePaid}>Paid digitally — ₹{amount.toFixed(2)}</Text>
          <Text style={styles.hint}>Don&apos;t collect any cash for this order.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>Customer wants to pay digitally?</Text>
      </View>
      <Text style={styles.hint}>
        Take ₹{amount.toFixed(2)} by UPI or card instead of cash. It won&apos;t count against your
        cash-in-hand.
      </Text>

      {phase === 'waiting' ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.waitingText}>Confirming payment…</Text>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={confirmStart}
          disabled={phase === 'opening'}
        >
          {phase === 'opening' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.buttonText}>
              {phase === 'failed' ? 'Try digital payment again' : 'Collect via UPI / Card'}
            </Text>
          )}
        </Pressable>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  cardPaid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: colors.success,
    backgroundColor: colors.successSoft,
  },
  body: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  titlePaid: { fontSize: 15, fontWeight: '600', color: colors.success },
  hint: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  button: {
    marginTop: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.primaryDark, fontWeight: '600', fontSize: 15 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
  waitingText: { color: colors.textMuted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
});
