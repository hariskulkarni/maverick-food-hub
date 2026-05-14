/**
 * Auth stack — the rider-only login flow (phone → OTP). No customer or staff
 * options anywhere; this app is for riders and nothing else.
 */
import { Stack } from 'expo-router';
import { colors } from '../../lib/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
