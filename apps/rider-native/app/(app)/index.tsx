/**
 * Dashboard — placeholder for now. It proves the authenticated state end to
 * end: the rider profile comes from the stored login, and the "connection
 * check" calls /api/rider/me with the Bearer token to confirm the session
 * works against the live backend.
 *
 * The real dashboard (online/offline toggle, current assignment, stats) lands
 * in the next task.
 */
import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

export default function DashboardScreen() {
  const { rider, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function checkConnection() {
    setChecking(true);
    setResult(null);
    try {
      const me = await api.me();
      setResult(
        `✓ Authenticated. Status: ${me.online ? 'online' : 'offline'}.`
      );
    } catch (e) {
      if (e instanceof ApiError) {
        setResult(`✗ ${e.message} (HTTP ${e.status})`);
      } else {
        setResult('✗ Connection failed.');
      }
    } finally {
      setChecking(false);
    }
  }

  const firstName = (rider?.name ?? 'Rider').split(' ')[0];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{firstName}</Text>
          </View>
          <View style={styles.riderPill}>
            <Text style={styles.riderPillText}>RIDER</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>You're signed in</Text>
          <Text style={styles.cardBody}>
            {rider?.phone ?? 'Unknown number'}
          </Text>
          <Text style={styles.cardHint}>
            The full dashboard — online toggle, your current delivery, and the
            order pool — is coming next. For now, confirm the app is talking to
            the server:
          </Text>

          <Pressable
            onPress={checkConnection}
            disabled={checking}
            style={({ pressed }) => [
              styles.checkButton,
              pressed && styles.checkButtonPressed,
              checking && styles.checkButtonDisabled,
            ]}
          >
            {checking ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.checkButtonText}>Check connection</Text>
            )}
          </Pressable>

          {result ? (
            <Text
              style={[
                styles.result,
                result.startsWith('✓') ? styles.resultOk : styles.resultErr,
              ]}
            >
              {result}
            </Text>
          ) : null}
        </View>

        <Pressable onPress={signOut} style={styles.signOut} hitSlop={8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  greeting: { fontSize: font.size.md, color: colors.textMuted },
  name: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  riderPill: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  riderPillText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 1.5,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  cardBody: {
    marginTop: spacing.xs,
    fontSize: font.size.md,
    color: colors.textMuted,
  },
  cardHint: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
  checkButton: {
    marginTop: spacing.lg,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonPressed: { backgroundColor: colors.primarySoft },
  checkButtonDisabled: { opacity: 0.6 },
  checkButtonText: {
    color: colors.primary,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  result: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  resultOk: { color: colors.success },
  resultErr: { color: colors.danger },
  signOut: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  signOutText: {
    fontSize: font.size.md,
    color: colors.danger,
    fontWeight: font.weight.semibold,
  },
});
