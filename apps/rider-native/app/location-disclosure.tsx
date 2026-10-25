/**
 * Prominent disclosure for background location (Google Play / App Store
 * policy). Shown BEFORE the OS "Allow all the time" / "Always" prompt, the
 * first time an accepted delivery needs background tracking. Explains what is
 * collected, why, when, and how to stop; only "Continue" triggers the system
 * permission request. "Not now" keeps foreground-only tracking.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { ScreenHeader } from '../components/screen-header';
import { startDeliveryTracking } from '../lib/background-location';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Point({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.pointText}>
        <Text style={styles.pointTitle}>{title}</Text>
        <Text style={styles.pointBody}>{body}</Text>
      </View>
    </View>
  );
}

export default function LocationDisclosureScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const settingName = Platform.OS === 'ios' ? 'Always' : 'Allow all the time';

  async function onContinue() {
    if (busy) return;
    setBusy(true);
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        Alert.alert(
          'Location is off',
          'Flavrly needs location access to track your deliveries. You can turn it on in your phone settings.',
          [
            { text: 'Not now', style: 'cancel', onPress: () => router.back() },
            { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); router.back(); } },
          ]
        );
        return;
      }
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        if (orderId) await startDeliveryTracking(orderId);
        router.back();
        return;
      }
      Alert.alert(
        'Background location not allowed',
        `Tracking will pause whenever Flavrly is not on screen. To keep customers updated while you use Google Maps, choose "${settingName}" under Location in your phone settings.`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => router.back() },
          { text: 'Open settings', onPress: () => { Linking.openSettings().catch(() => {}); router.back(); } },
        ]
      );
    } catch {
      router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Location while delivering" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Ionicons name="navigate-circle" size={48} color={colors.primary} />
          <Text style={styles.heroTitle}>Flavrly uses your location in the background during deliveries</Text>
          <Text style={styles.heroBody}>
            Flavrly collects your phone&apos;s location to enable live order tracking, even when the app is
            closed, in the background, or the screen is locked, but only while you have an active delivery.
          </Text>
        </View>

        <View style={styles.card}>
          <Point
            icon="locate-outline"
            title="What we collect"
            body="Your precise GPS location and speed, about every 15 seconds or 30 metres while you move."
          />
          <Point
            icon="people-outline"
            title="Why"
            body="So the customer can follow their order on the live map, the restaurant and Flavrly support can see where the order is, and for your safety if something goes wrong on the road."
          />
          <Point
            icon="time-outline"
            title="When"
            body="In the background only from the moment you accept a delivery until it is delivered, cancelled or closed by support. You can keep using Google Maps or lock your phone; tracking continues. With the app open and you online, your location is also shared so we can offer you nearby orders."
          />
          {Platform.OS === 'android' ? (
            <Point
              icon="notifications-outline"
              title="You will always know"
              body={'While it runs, a notification stays in your status bar: "Flavrly is sharing your location for an active delivery."'}
            />
          ) : (
            <Point
              icon="notifications-outline"
              title="You will always know"
              body="While it runs, iPhone shows a blue location indicator in the status bar."
            />
          )}
          <Point
            icon="stop-circle-outline"
            title="How to stop"
            body={`It stops by itself when the delivery ends, when you go offline, or when you sign out. You can also change Location to "While using the app" in your phone settings; tracking then pauses whenever Flavrly is not on screen.`}
          />
        </View>

        <Text style={styles.next}>
          On the next screen, choose &quot;{settingName}&quot; for Flavrly&apos;s location.
        </Text>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          onPress={onContinue}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Continue</Text>}
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => router.back()} disabled={busy} accessibilityRole="button">
          <Text style={styles.secondaryBtnText}>Not now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  hero: { alignItems: 'center', paddingVertical: spacing.md },
  heroTitle: {
    marginTop: spacing.sm,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  heroBody: {
    marginTop: spacing.sm,
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    ...shadow.card,
  },
  point: { flexDirection: 'row', gap: spacing.md },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { flex: 1 },
  pointTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: colors.text },
  pointBody: { marginTop: 2, fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
  next: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    color: colors.text,
    textAlign: 'center',
    fontWeight: font.weight.medium,
  },
  actions: { padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  primaryBtn: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: { backgroundColor: colors.primaryDark },
  primaryBtnText: { color: colors.white, fontSize: font.size.md, fontWeight: font.weight.bold },
  secondaryBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: colors.textMuted, fontSize: font.size.md, fontWeight: font.weight.semibold },
});
