/**
 * Refer a Rider — share your code, earn a bonus when a friend signs up and
 * starts delivering.
 *
 * Shows the rider's referral code prominently with a native Share sheet, the
 * total bonus earned, a 3-step "how it works" explainer, an inline form to
 * log a referral, and the history of past referrals with status chips.
 *
 * Wired to GET/POST /api/rider/referrals.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
  TextInput,
  Share,
  Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import {
  growth,
  type ReferralsResponse,
  type Referral,
  type ReferralStatus,
} from '../lib/api-growth';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const STATUS_STYLE: Record<ReferralStatus, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: '#fdf4e3', fg: colors.warning, label: 'Pending' },
  SIGNED_UP: { bg: colors.primarySoft, fg: colors.primary, label: 'Signed up' },
  QUALIFIED: { bg: colors.primarySoft, fg: colors.primaryDark, label: 'Qualified' },
  REWARDED: { bg: colors.successSoft, fg: colors.success, label: 'Rewarded' },
};

const STEPS = [
  {
    icon: 'share-social-outline' as const,
    title: 'Share your code',
    body: 'Send your referral code to friends who want to ride with Oak & Sizzler.',
  },
  {
    icon: 'person-add-outline' as const,
    title: 'They sign up',
    body: 'Your friend joins as a rider and enters your code during onboarding.',
  },
  {
    icon: 'cash-outline' as const,
    title: 'You both earn',
    body: 'Once they complete their qualifying deliveries, your bonus is credited.',
  },
];

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ReferScreen() {
  const [data, setData] = useState<ReferralsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await growth.referrals());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your referrals.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await load();
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function onShare() {
    if (!data) return;
    try {
      await Share.share({
        message:
          `Ride with Oak & Sizzler and earn on every delivery! ` +
          `Use my referral code ${data.code} when you sign up as a delivery partner.`,
      });
    } catch {
      // User dismissed the sheet — nothing to do.
    }
  }

  async function onSubmit() {
    if (submitting) return;
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      Alert.alert('Phone needed', "Enter your friend's mobile number.");
      return;
    }
    setSubmitting(true);
    try {
      await growth.createReferral(trimmedPhone, name.trim() || undefined);
      setPhone('');
      setName('');
      setShowForm(false);
      await load();
    } catch (e) {
      Alert.alert(
        'Could not log referral',
        e instanceof ApiError ? e.message : 'Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Refer a Rider</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => {
              setLoading(true);
              load().then(() => setLoading(false));
            }}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* Code hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>YOUR REFERRAL CODE</Text>
            <Text style={styles.heroCode}>{data.code}</Text>
            <Pressable
              style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}
              onPress={onShare}
            >
              <Ionicons name="share-social" size={18} color={colors.white} />
              <Text style={styles.shareBtnText}>Share</Text>
            </Pressable>
          </View>

          {/* Total earned */}
          <View style={styles.earnedCard}>
            <View>
              <Text style={styles.earnedLabel}>Total earned</Text>
              <Text style={styles.earnedSub}>
                {data.referrals.length} referral
                {data.referrals.length === 1 ? '' : 's'} so far
              </Text>
            </View>
            <Text style={styles.earnedValue}>{rupees(data.totalEarned)}</Text>
          </View>

          {/* How it works */}
          <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
          <View style={styles.card}>
            {STEPS.map((step, i) => (
              <View
                key={step.title}
                style={[styles.stepRow, i === STEPS.length - 1 && styles.stepRowLast]}
              >
                <View style={styles.stepIcon}>
                  <Ionicons name={step.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepTitle}>
                    {i + 1}. {step.title}
                  </Text>
                  <Text style={styles.stepBody}>{step.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Log a referral */}
          <Text style={styles.sectionLabel}>LOG A REFERRAL</Text>
          {showForm ? (
            <View style={styles.card}>
              <View style={styles.formPad}>
                <Text style={styles.inputLabel}>Friend's mobile number</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={15}
                />
                <Text style={[styles.inputLabel, { marginTop: spacing.md }]}>
                  Friend's name (optional)
                </Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Name"
                  placeholderTextColor={colors.textMuted}
                  maxLength={80}
                />
                <View style={styles.formActions}>
                  <Pressable
                    style={[styles.formBtn, styles.formBtnGhost]}
                    onPress={() => {
                      setShowForm(false);
                      setPhone('');
                      setName('');
                    }}
                    disabled={submitting}
                  >
                    <Text style={styles.formBtnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.formBtn, styles.formBtnPrimary]}
                    onPress={onSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <Text style={styles.formBtnPrimaryText}>Add referral</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
              onPress={() => setShowForm(true)}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.addBtnText}>Add a referral</Text>
            </Pressable>
          )}

          {/* Past referrals */}
          <Text style={styles.sectionLabel}>YOUR REFERRALS</Text>
          {data.referrals.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No referrals yet — share your code above and they'll show up here.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {data.referrals.map((r: Referral, i) => {
                const s = STATUS_STYLE[r.status];
                return (
                  <View
                    key={r.id}
                    style={[
                      styles.refRow,
                      i === data.referrals.length - 1 && styles.refRowLast,
                    ]}
                  >
                    <View style={styles.refLeft}>
                      <Text style={styles.refName}>
                        {r.refereeName || r.refereePhone || 'Referral'}
                      </Text>
                      <Text style={styles.refMeta}>
                        {r.refereePhone ? `${r.refereePhone} · ` : ''}
                        {fmtDate(r.createdAt)}
                      </Text>
                    </View>
                    <View style={styles.refRight}>
                      <View style={[styles.statusChip, { backgroundColor: s.bg }]}>
                        <Text style={[styles.statusChipText, { color: s.fg }]}>
                          {s.label}
                        </Text>
                      </View>
                      <Text style={styles.refBonus}>{rupees(r.bonusAmount)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  errorText: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryBtnText: {
    color: colors.primary,
    fontWeight: font.weight.semibold,
    fontSize: font.size.sm,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  pressed: { opacity: 0.7 },

  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadow.card,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.white,
    opacity: 0.85,
    letterSpacing: 1.5,
  },
  heroCode: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.white,
    letterSpacing: 3,
    marginVertical: spacing.md,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  shareBtnText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.md,
  },

  earnedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
    ...shadow.card,
  },
  earnedLabel: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  earnedSub: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
  earnedValue: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.success,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },

  stepRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepRowLast: { borderBottomWidth: 0 },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1 },
  stepTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  stepBody: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 19,
    marginTop: 2,
  },

  formPad: { padding: spacing.lg },
  inputLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: font.size.md,
    color: colors.text,
  },
  formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  formBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBtnGhost: { borderWidth: 1, borderColor: colors.border },
  formBtnGhostText: {
    color: colors.textMuted,
    fontWeight: font.weight.semibold,
    fontSize: font.size.sm,
  },
  formBtnPrimary: { backgroundColor: colors.primary },
  formBtnPrimaryText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.sm,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.primarySoft,
  },
  addBtnText: {
    color: colors.primary,
    fontWeight: font.weight.semibold,
    fontSize: font.size.md,
  },

  list: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  refRowLast: { borderBottomWidth: 0 },
  refLeft: { flex: 1, marginRight: spacing.md },
  refName: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  refMeta: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
  refRight: { alignItems: 'flex-end', gap: 4 },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusChipText: { fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.5 },
  refBonus: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.text,
  },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyText: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
});
