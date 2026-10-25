/**
 * Update prompts driven by lib/app-update.ts:
 *   - <UpdateBanner>          dismissible "Update available" strip (top overlay)
 *   - <UpdateRequiredScreen>  blocking screen when this build is no longer
 *                             supported — still offers emergency help (112,
 *                             Flavrly support and, when signed in, the SOS alert).
 */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { LatestRelease } from '../lib/app-update';
import { useAuth } from '../lib/auth';
import { useSos } from '../lib/use-sos';
import { colors, spacing, radius, font } from '../lib/theme';

const SUPPORT_PHONE = '+919213995005';

function openDownload(latest: LatestRelease) {
  Linking.openURL(latest.storeUrl || latest.downloadUrl).catch(() =>
    Alert.alert('Could not open the download', 'Open flavrly.in/rider-app in Chrome to download the latest app.')
  );
}

function sizeLabel(n: number | null): string {
  return n ? ` · ${(n / (1024 * 1024)).toFixed(1)} MB` : '';
}

export function UpdateBanner({ latest, onDismiss }: { latest: LatestRelease; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bannerWrap, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
      <View style={styles.banner} accessibilityRole="alert">
        <Ionicons name="arrow-down-circle" size={22} color={colors.primary} />
        <Pressable style={styles.bannerBody} onPress={() => openDownload(latest)} accessibilityRole="button" accessibilityLabel={`Update available, version ${latest.versionName}. Tap to download.`}>
          <Text style={styles.bannerTitle}>Update available · v{latest.versionName}</Text>
          <Text style={styles.bannerText} numberOfLines={2}>
            {latest.releaseNotes?.trim() || 'Tap to download the latest Flavrly Rider app.'}
          </Text>
        </Pressable>
        <Pressable onPress={onDismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss update banner">
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function SosButton() {
  const { activeAlert, trigger } = useSos();
  const [busy, setBusy] = useState(false);
  if (activeAlert) {
    return (
      <View style={[styles.secondaryBtn, { borderColor: colors.danger }]}>
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <Text style={[styles.secondaryText, { color: colors.danger }]}>SOS sent — help is on the way</Text>
      </View>
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.sosBtn, pressed && { opacity: 0.85 }]}
      disabled={busy}
      onPress={() =>
        Alert.alert('Send SOS?', 'Flavrly ops and your emergency contact will be alerted with your location.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Send SOS',
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await trigger(undefined, 'Sent from the "Update required" screen');
              } catch {
                Alert.alert('SOS not sent', 'Call 112 or Flavrly support directly.');
              } finally {
                setBusy(false);
              }
            },
          },
        ])
      }
      accessibilityRole="button"
      accessibilityLabel="Send SOS alert"
    >
      {busy ? <ActivityIndicator color={colors.white} /> : <Ionicons name="warning" size={18} color={colors.white} />}
      <Text style={styles.sosText}>Send SOS</Text>
    </Pressable>
  );
}

export function UpdateRequiredScreen({ latest, currentVersionName }: { latest: LatestRelease; currentVersionName: string | null }) {
  const { token } = useAuth();
  return (
    <SafeAreaView style={styles.reqRoot}>
      <ScrollView contentContainerStyle={styles.reqScroll}>
        <View style={styles.reqIcon}>
          <Ionicons name="cloud-download-outline" size={36} color={colors.primary} />
        </View>
        <Text style={styles.reqTitle}>Update required</Text>
        <Text style={styles.reqBody}>
          This version{currentVersionName ? ` (${currentVersionName})` : ''} of Flavrly Rider is no longer supported. Install version{' '}
          {latest.versionName} to keep receiving and delivering orders.
        </Text>
        {latest.releaseNotes ? <Text style={styles.reqNotes}>{latest.releaseNotes.trim()}</Text> : null}
        <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { backgroundColor: colors.primaryDark }]} onPress={() => openDownload(latest)} accessibilityRole="button">
          <Ionicons name="download" size={18} color={colors.white} />
          <Text style={styles.primaryText}>Download v{latest.versionName}{sizeLabel(latest.fileSize)}</Text>
        </Pressable>
        <Text style={styles.reqHint}>After it downloads, tap the file and choose Install. Your account and earnings stay as they are.</Text>

        <View style={styles.divider} />
        <Text style={styles.emTitle}>Need help right now?</Text>
        {token ? <SosButton /> : null}
        <Pressable style={styles.secondaryBtn} onPress={() => Linking.openURL('tel:112')} accessibilityRole="button" accessibilityLabel="Call emergency services 112">
          <Ionicons name="call" size={18} color={colors.danger} />
          <Text style={[styles.secondaryText, { color: colors.danger }]}>Emergency · call 112</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityRole="button" accessibilityLabel="Call Flavrly rider support">
          <Ionicons name="headset" size={18} color={colors.text} />
          <Text style={styles.secondaryText}>Call Flavrly support</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bannerWrap: { position: 'absolute', left: spacing.md, right: spacing.md, zIndex: 50 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: colors.black,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerBody: { flex: 1, minHeight: 44, justifyContent: 'center' },
  bannerTitle: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: colors.text },
  bannerText: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
  reqRoot: { flex: 1, backgroundColor: colors.bg },
  reqScroll: { padding: spacing.xl, alignItems: 'stretch', flexGrow: 1, justifyContent: 'center' },
  reqIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  reqTitle: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: colors.text, textAlign: 'center' },
  reqBody: { marginTop: spacing.sm, fontSize: font.size.md, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  reqNotes: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    padding: spacing.md,
    lineHeight: 20,
  },
  reqHint: { marginTop: spacing.sm, fontSize: font.size.xs, color: colors.textMuted, textAlign: 'center' },
  primaryBtn: {
    marginTop: spacing.lg,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryText: { color: colors.white, fontSize: font.size.md, fontWeight: font.weight.bold },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  emTitle: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: colors.text, marginBottom: spacing.sm },
  sosBtn: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sosText: { color: colors.white, fontSize: font.size.md, fontWeight: font.weight.bold },
  secondaryBtn: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  secondaryText: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
});
