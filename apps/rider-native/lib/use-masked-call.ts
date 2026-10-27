/**
 * Masked "Call customer" for the delivery screen.
 *
 * The app never holds the customer's number. Tapping "Call customer" explains
 * what will happen, then asks the server (POST …/call-customer) to ring the
 * rider's own phone and bridge them to the customer through Flavrly's virtual
 * number — the customer doesn't see the rider's number either.
 *
 * `onFallback` (optional) opens the existing "Customer unreachable" flow; it's
 * offered when calling isn't possible (not set up, no number, too many tries,
 * provider error) so the rider is never stuck.
 */
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { api, ApiError } from './api';

const FALLBACK_CODES = new Set(['telephony_unavailable', 'customer_phone_missing', 'rate_limited', 'call_failed']);

export function useMaskedCall(assignmentId: string | null, onFallback?: () => void) {
  const [calling, setCalling] = useState(false);
  const busy = useRef(false);

  const place = useCallback(async () => {
    if (!assignmentId || busy.current) return;
    busy.current = true;
    setCalling(true);
    try {
      const r = await api.callCustomer(assignmentId);
      Alert.alert('Call placed', `${r.message}. Answer the incoming call to talk to the customer.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        Alert.alert("You're offline", 'The call was not placed. Check your connection and try again.');
        return;
      }
      const code =
        e instanceof ApiError && e.body && typeof e.body === 'object' ? String((e.body as any).error ?? '') : '';
      const message = e instanceof ApiError ? e.message : 'Could not place the call. Please try again.';
      if (onFallback && FALLBACK_CODES.has(code)) {
        Alert.alert('Could not call the customer', message, [
          { text: 'OK', style: 'cancel' },
          { text: 'Customer unreachable', onPress: onFallback },
        ]);
      } else {
        Alert.alert('Could not call the customer', message);
      }
    } finally {
      busy.current = false;
      setCalling(false);
    }
  }, [assignmentId, onFallback]);

  /** Explain first, then place the call on confirmation. */
  const confirmAndCall = useCallback(() => {
    if (busy.current) return;
    Alert.alert(
      'Call the customer?',
      "Flavrly will ring YOUR phone first. Pick up and we'll connect you to the customer.\n\nYour number stays hidden from them, and theirs from you.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call now', onPress: () => void place() },
      ]
    );
  }, [place]);

  return { calling, confirmAndCall };
}
