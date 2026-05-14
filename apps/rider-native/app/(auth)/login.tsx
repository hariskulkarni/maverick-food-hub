/**
 * Login — step 1. Rider enters their phone number; we request an OTP.
 *
 * Rider-only by construction: the backend's /api/rider/auth/request-otp rejects
 * any number that isn't a registered rider, so there are no customer/staff
 * paths to clutter this screen.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, ApiError } from '../../lib/api';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const valid = digits.length === 10;

  async function onSubmit() {
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);
    const phone = `+91${digits}`;
    try {
      const res = await api.requestOtp(phone);
      router.push({
        pathname: '/verify',
        params: { phone, devCode: res.devCode ?? '' },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setError("That number isn't registered as a rider.");
      } else if (e instanceof ApiError && e.status === 429) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          {/* Brand */}
          <View style={styles.brand}>
            <View style={styles.logoMark}>
              <Text style={styles.logoGlyph}>O&S</Text>
            </View>
            <Text style={styles.wordmark}>Oak &amp; Sizzler</Text>
            <View style={styles.riderPill}>
              <Text style={styles.riderPillText}>RIDER</Text>
            </View>
          </View>

          {/* Heading */}
          <View style={styles.heading}>
            <Text style={styles.title}>Sign in to start{'\n'}delivering</Text>
            <Text style={styles.subtitle}>
              Enter your registered rider phone number. We'll text you a
              verification code.
            </Text>
          </View>

          {/* Phone input */}
          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <View style={[styles.inputRow, error ? styles.inputRowError : null]}>
              <Text style={styles.prefix}>+91</Text>
              <View style={styles.divider} />
              <TextInput
                style={styles.input}
                value={digits}
                onChangeText={(t) => {
                  setDigits(t.replace(/[^0-9]/g, '').slice(0, 10));
                  if (error) setError(null);
                }}
                placeholder="98765 43210"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={10}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          {/* Submit */}
          <Pressable
            onPress={onSubmit}
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
              <Text style={styles.buttonText}>Send verification code</Text>
            )}
          </Pressable>

          <Text style={styles.footnote}>
            Only registered riders can sign in here. Contact your operations
            team if you need access.
          </Text>
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
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyph: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.sm,
  },
  wordmark: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  riderPill: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginLeft: spacing.xs,
  },
  riderPillText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 1.5,
  },
  heading: { marginTop: spacing.xxl },
  title: {
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold,
    color: colors.text,
    lineHeight: 40,
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: font.size.md,
    color: colors.textMuted,
    lineHeight: 22,
  },
  field: { marginTop: spacing.xl },
  label: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 56,
  },
  inputRowError: { borderColor: colors.danger },
  prefix: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    fontSize: font.size.md,
    color: colors.text,
    letterSpacing: 1,
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
  buttonDisabled: { backgroundColor: colors.border, ...{ shadowOpacity: 0 }, elevation: 0 },
  buttonPressed: { backgroundColor: colors.primaryDark },
  buttonText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  footnote: {
    marginTop: 'auto',
    fontSize: font.size.xs,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
