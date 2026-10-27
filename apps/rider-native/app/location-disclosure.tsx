/**
 * Prominent disclosure for background location (Google Play / App Store
 * policy). Shown BEFORE the OS "Allow all the time" / "Always" prompt, the
 * first time the rider goes online (or an accepted delivery needs background
 * tracking) without that permission. Explains what is
 * collected (location, plus on-duty device/network/battery info and online
 * status history), why, when, how long it is kept, and how to stop; only "Continue" triggers the system
 * permission request. "Not now" keeps foreground-only tracking.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { ScreenHeader } from '../components/screen-header';
import { startDeliveryTracking, startOnlineTracking } from '../lib/background-location';
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
        else await startOnlineTracking();
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
      <ScreenHeader title="Location while you're online" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Ionicons name="navigate-circle" size={48} color={colors.primary} />
          <Text style={styles.heroTitle}>Flavrly uses your location in the background while you&apos;re online</Text>
          <Text style={styles.heroBody}>
            Flavrly collects your phone&apos;s location to offer you nearby orders and to enable live order
            tracking, even when the app is closed, in the background, or the screen is locked, but only while
            you are online or on an active delivery. Go offline and it stops.
          </Text>
        </View>

        <View style={styles.card}>
          <Point
            icon="locate-outline"
            title="What we collect"
            body="Your location about every 30 seconds while you are online and waiting for orders, and your precise GPS location and speed about every 15 seconds or 30 metres while you are on a delivery."
          />
          <Point
            icon="phone-portrait-outline"
            title="Device and network info"
            body="While you are online we also send your phone model, Android/iOS version, Flavrly app version, network type (Wi-Fi or mobile data, and 4G/5G when your phone reports it) and battery level and charging status, plus the times you go online or offline or lose signal. This helps support fix tracking and connection problems. We never read your IMEI, the other apps on your phone, or your calls."
          />
          <Point
            icon="people-outline"
            title="Why"
            body="So we can offer you orders near you and keep you online while your phone is in your pocket, so the customer can follow their order on the live map, the restaurant and Flavrly support can see where the order is, and for your safety if something goes wrong on the road."
          />
          <Point
            icon="shield-checkmark-outline"
            title="Keeping deliveries fair"
            body="To prevent fraud, Flavrly checks that the location you share is genuine (not a fake-GPS / mock location) and that you are using the official Flavrly app on a standard device. We receive only a pass/fail result of that app check — never the list of apps on your phone, your calls, or anything about your personal phone use."
          />
          <Point
            icon="time-outline"
            title="When"
            body="In the background only from the moment you go online until you go offline (and during any delivery you accept, until it is delivered, cancelled or closed by support). You can keep using Google Maps or lock your phone; tracking continues. It never runs while you are offline."
          />
          {Platform.OS === 'android' ? (
            <Point
              icon="notifications-outline"
              title="You will always know"
              body={'While it runs, a notification stays in your status bar: "You\'re online" or "Delivery in progress".'}
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
            body={`Your route history is kept for 90 days and device info for 30 days, then deleted. It stops by itself when you go offline or sign out. You can also change Location to "While using the app" in your phone settings; tracking then pauses whenever Flavrly is not on screen, and you may be set offline after 2 minutes away from the app.`}
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
