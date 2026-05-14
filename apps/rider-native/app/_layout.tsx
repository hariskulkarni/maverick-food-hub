/**
 * Root layout — wraps the whole app in the auth provider and gates the first
 * render on the persisted-token restore so we never flash the login screen at
 * a rider who's already signed in.
 *
 * Also exports an `ErrorBoundary`: expo-router renders this instead of a blank
 * white screen whenever a screen throws while rendering, so an unexpected crash
 * becomes a calm, branded "try again" screen rather than a dead app.
 */
import { Stack } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { colors, spacing, radius, font } from '../lib/theme';

/**
 * App-wide render-error fallback. `retry()` re-mounts the failed segment, which
 * is enough to recover from transient issues (a slow / restarting backend, a
 * one-off render glitch) without the rider having to force-quit the app.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errRoot}>
      <View style={styles.errIcon}>
        <Ionicons name="cloud-offline-outline" size={34} color={colors.primary} />
      </View>
      <Text style={styles.errTitle}>Something went wrong</Text>
      <Text style={styles.errBody}>
        The app hit an unexpected snag. This is usually temporary — tap below to
        try again. If it keeps happening, check your connection or reach out to
        your operations team.
      </Text>
      <Text style={styles.errDetail} numberOfLines={3}>
        {error?.message ?? 'Unknown error'}
      </Text>
      <Pressable
        onPress={retry}
        style={({ pressed }) => [styles.errBtn, pressed && styles.errBtnPressed]}
      >
        <Ionicons name="refresh" size={18} color={colors.white} />
        <Text style={styles.errBtnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function RootNavigator() {
  const { loading } = useAuth();

  if (loading) {
    // Brief splash while SecureStore is read on cold start.
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  errRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
  },
  errIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  errTitle: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  errBody: {
    marginTop: spacing.sm,
    fontSize: font.size.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  errDetail: {
    marginTop: spacing.md,
    fontSize: font.size.xs,
    color: colors.textMuted,
    textAlign: 'center',
    fontFamily: 'monospace',
    opacity: 0.7,
  },
  errBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    height: 52,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  errBtnPressed: { backgroundColor: colors.primaryDark },
  errBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
});
