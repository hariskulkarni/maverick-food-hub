/**
 * Login — step 2. Rider enters the 6-digit OTP; on success we store the Bearer
 * token + profile and drop them into the app.
 *
 * When the backend runs with OTP_DEBUG_LOG=true (demo / pre-SMS-provider), the
 * request-otp response carries the code — we surface it here as a "Demo mode"
 * hint and pre-fill it, so a demo doesn't need someone reading server logs.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

export default function VerifyScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const phone = params.phone ?? '';
  const devCode = params.devCode ?? '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  // Demo convenience: pre-fill the code when the backend handed it to us.
  useEffect(() => {
    if (devCode) setCode(devCode);
  }, [devCode]);

  const valid = code.length === 6;

  async function onVerify() {
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.verifyOtp(phone, code);
      await signIn(res.token, res.rider);
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('That code is incorrect or has expired.');
      } else if (e instanceof ApiError && e.status === 403) {
        setError('This number is not a rider account.');
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (resending) return;
    setError(null);
    setResending(true);
    try {
      const res = await api.requestOtp(phone);
      if (res.devCode) setCode(res.devCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>

          <View style={styles.heading}>
            <Text style={styles.title}>Enter your code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={styles.phone}>{phone}</Text>
            </Text>
          </View>

          {devCode ? (
            <View style={styles.demoHint}>
              <Text style={styles.demoHintLabel}>DEMO MODE</Text>
              <Text style={styles.demoHintText}>
                SMS isn't wired up yet — your code is{' '}
                <Text style={styles.demoHintCode}>{devCode}</Text> (pre-filled
                below).
              </Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <View style={[styles.inputRow, error ? styles.inputRowError : null]}>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={(t) => {
                  setCode(t.replace(/[^0-9]/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
                placeholder="••••••"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus={!devCode}
                returnKeyType="go"
                onSubmitEditing={onVerify}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          <Pressable
            onPress={onVerify}
            disabled={!valid || submitting}
            style={({ pressed }) => [
              styles.button,
              (!valid || submitting) && styles.buttonDisabled,
              pressed && valid && !submitting && styles.buttonPressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.buttonText}>Verify &amp; continue</Text>
            )}
          </Pressable>

          <Pressable onPress={onResend} disabled={resending} style={styles.resend}>
            <Text style={styles.resendText}>
              {resending ? 'Sending…' : "Didn't get it? Resend code"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  back: {
    fontSize: font.size.md,
    color: colors.textMuted,
    fontWeight: font.weight.medium,
  },
  heading: { marginTop: spacing.xl },
  title: {
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: font.size.md,
    color: colors.textMuted,
    lineHeight: 22,
  },
  phone: { color: colors.text, fontWeight: font.weight.semibold },
  demoHint: {
    marginTop: spacing.lg,
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
    marginBottom: spacing.xs,
  },
  demoHintText: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
  },
  demoHintCode: { fontWeight: font.weight.bold, color: colors.primaryDark },
  field: { marginTop: spacing.xl },
  inputRow: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 64,
    justifyContent: 'center',
  },
  inputRowError: { borderColor: colors.danger },
  input: {
    fontSize: 28,
    color: colors.text,
    letterSpacing: 12,
    textAlign: 'center',
    fontWeight: font.weight.semibold,
  },
  error: {
    marginTop: spacing.sm,
    color: colors.danger,
    fontSize: font.size.sm,
  },
  button: {
    marginTop: spacing.xl,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  buttonDisabled: { backgroundColor: colors.border, shadowOpacity: 0, elevation: 0 },
  buttonPressed: { backgroundColor: colors.primaryDark },
  buttonText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  resend: {
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  resendText: {
    fontSize: font.size.sm,
    color: colors.primary,
    fontWeight: font.weight.semibold,
  },
});
