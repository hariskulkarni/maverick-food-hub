/**
 * Safety Centre — the rider's hub for everything safety.
 *
 *   • A prominent <SosButton /> at the top — one tap to panic.
 *   • Cards linking to Emergency Contacts and Report an Incident.
 *   • "Share my live trip" — mints a 4-hour share link and opens the OS share
 *     sheet so the rider can send it to family.
 *   • A short list of static safety tips.
 *
 * Full-screen route (pushed over the tab bar) with its own back header.
 */
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SosButton } from '../components/sos-button';
import { ScreenHeader } from '../components/screen-header';
import { safety } from '../lib/api-safety';
import { ApiError } from '../lib/api';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const SAFETY_TIPS = [
  'Wear your helmet on every ride — even the short ones.',
  'Trust your instincts. If a drop-off feels unsafe, call support before entering.',
  'Keep your phone charged; a dead phone is a real risk on the road.',
  'Share your live trip with family when riding late at night.',
  'In an emergency, dial 112 first — then trigger SOS so we can help too.',
];

interface NavCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  busy?: boolean;
}

function NavCard({ icon, title, subtitle, onPress, busy }: NavCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.navCard, pressed && styles.navCardPressed]}
      onPress={onPress}
      disabled={busy}
    >
      <View style={styles.navIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={styles.navText}>
        <Text style={styles.navTitle}>{title}</Text>
        <Text style={styles.navSub}>{subtitle}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

export default function SafetyScreen() {
  const [sharing, setSharing] = useState(false);

  async function shareLiveTrip() {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await safety.createTripShare();
      await Share.share({
        message: `Follow my live delivery trip on Flavrly: ${res.shareUrl}\n\nThis link is active for the next 4 hours.`,
        url: res.shareUrl,
      });
    } catch (e) {
      Alert.alert(
        'Could not create share link',
        e instanceof ApiError ? e.message : 'Please check your connection and try again.'
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Safety Centre" />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Your safety comes first. Everything here is one tap away — keep it
          handy on every shift.
        </Text>

        {/* Panic button */}
        <SosButton />

        {/* Quick actions */}
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <View style={styles.cardGroup}>
          <NavCard
            icon="people-outline"
            title="Emergency Contacts"
            subtitle="Who we alert when you trigger SOS"
            onPress={() => router.push('/emergency-contacts')}
          />
          <NavCard
            icon="document-text-outline"
            title="Report an Incident"
            subtitle="Accident, breakdown, harassment & more"
            onPress={() => router.push('/report-incident')}
          />
          <NavCard
            icon="share-social-outline"
            title="Share my live trip"
            subtitle="Send a 4-hour live-location link to family"
            onPress={shareLiveTrip}
            busy={sharing}
          />
        </View>

        {/* Safety tips */}
        <Text style={styles.sectionLabel}>SAFETY TIPS</Text>
        <View style={styles.tipsCard}>
          {SAFETY_TIPS.map((tip, i) => (
            <View
              key={i}
              style={[styles.tipRow, i === SAFETY_TIPS.length - 1 && styles.tipRowLast]}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={colors.success}
                style={styles.tipIcon}
              />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.footer}>
          In a life-threatening emergency, always call 112 first.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  intro: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },

  cardGroup: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navCardPressed: { backgroundColor: colors.primarySoft },
  navIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { flex: 1 },
  navTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  navSub: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },

  tipsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tipRowLast: { borderBottomWidth: 0 },
  tipIcon: { marginTop: 1 },
  tipText: {
    flex: 1,
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
  },

  footer: {
    marginTop: spacing.xl,
    textAlign: 'center',
    fontSize: font.size.xs,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
