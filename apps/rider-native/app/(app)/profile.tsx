/**
 * Profile tab — rider identity, editable display name, KYC document status,
 * and sign-out. KYC *uploads* stay on the web portal (multi-document forms);
 * this screen surfaces the verification status at a glance.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, type KycDoc, type RiderMe } from '../../lib/api';
import { growth, type TierName } from '../../lib/api-growth';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';
import { DocumentViewer, type ViewableDoc } from '../../components/document-viewer';
import { TierBadge } from '../../components/tier-badge';

/** A tappable navigation row into one of the rider-tool screens. */
function ToolRow({
  icon,
  label,
  hint,
  route,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  route: string;
  tint?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.toolRow, pressed && styles.toolRowPressed]}
      onPress={() => router.push(route as never)}
    >
      <View style={[styles.toolIcon, { backgroundColor: (tint ?? colors.primary) + '1a' }]}>
        <Ionicons name={icon} size={20} color={tint ?? colors.primary} />
      </View>
      <View style={styles.toolText}>
        <Text style={styles.toolLabel}>{label}</Text>
        <Text style={styles.toolHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function statusColor(status: string): { bg: string; fg: string } {
  const s = status.toUpperCase();
  if (s === 'VERIFIED' || s === 'APPROVED') return { bg: colors.successSoft, fg: colors.success };
  if (s === 'REJECTED' || s === 'EXPIRED') return { bg: colors.dangerSoft, fg: colors.danger };
  return { bg: '#fdf4e3', fg: colors.warning }; // PENDING / unknown
}

function prettyType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ProfileScreen() {
  const { rider, token, signOut, updateRider } = useAuth();

  const [docs, setDocs] = useState<KycDoc[]>([]);
  const [kycLoading, setKycLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(rider?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<ViewableDoc | null>(null);
  const [tier, setTier] = useState<TierName | null>(null);
  const [me, setMe] = useState<RiderMe | null>(null);

  const loadKyc = useCallback(async () => {
    try {
      const res = await api.kyc();
      setDocs(res.documents);
    } catch {
      setDocs([]);
    }
  }, []);

  const loadTier = useCallback(async () => {
    try {
      const res = await growth.tier();
      setTier(res.current.name);
    } catch {
      setTier(null);
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await Promise.all([loadKyc(), loadTier(), loadMe()]);
        if (!cancelled) setKycLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [loadKyc, loadTier, loadMe])
  );

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || savingName) return;
    setSavingName(true);
    try {
      await api.updateProfile({ name: trimmed });
      await updateRider({ name: trimmed });
      setEditing(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSavingName(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out', 'You will need your phone number and an OTP to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  const name = rider?.name ?? 'Rider';
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Profile</Text>

        {/* Identity card */}
        <View style={styles.card}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials || 'R'}</Text>
            </View>
            <View style={styles.identityText}>
              {editing ? (
                <TextInput
                  style={styles.nameInput}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder="Your name"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  maxLength={80}
                />
              ) : (
                <Text style={styles.name}>{name}</Text>
              )}
              <Text style={styles.phone}>{rider?.phone ?? 'No phone on file'}</Text>
              {me ? (
                <View style={styles.riderTypeRow}>
                  <Ionicons
                    name={me.riderType === 'DEDICATED' ? 'restaurant' : 'globe-outline'}
                    size={13}
                    color={colors.primary}
                  />
                  <Text style={styles.riderTypeText} numberOfLines={1}>
                    {me.riderType === 'DEDICATED'
                      ? `Dedicated rider · ${me.dedicatedRestaurant?.name ?? 'Restaurant'}`
                      : 'Fleet rider'}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.identityBadges}>
              <View style={styles.riderPill}>
                <Text style={styles.riderPillText}>RIDER</Text>
              </View>
              {tier ? <TierBadge tier={tier} size="sm" /> : null}
            </View>
          </View>

          {editing ? (
            <View style={styles.editActions}>
              <Pressable
                style={[styles.editBtn, styles.editBtnGhost]}
                onPress={() => {
                  setEditing(false);
                  setNameInput(rider?.name ?? '');
                }}
                disabled={savingName}
              >
                <Text style={styles.editBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.editBtn, styles.editBtnPrimary]}
                onPress={saveName}
                disabled={savingName}
              >
                {savingName ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.editBtnPrimaryText}>Save</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={styles.editLink}
              onPress={() => {
                setNameInput(rider?.name ?? '');
                setEditing(true);
              }}
              hitSlop={8}
            >
              <Ionicons name="pencil" size={14} color={colors.primary} />
              <Text style={styles.editLinkText}>Edit name</Text>
            </Pressable>
          )}
        </View>

        {/* KYC */}
        <Text style={styles.sectionLabel}>MY DOCUMENTS</Text>
        {kycLoading ? (
          <View style={styles.kycLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : docs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No KYC documents on file. Upload your ID, licence and insurance on
              the web rider portal to get verified.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.kycList}>
              {docs.map((d) => {
                const c = statusColor(d.status);
                const canView = !!d.fileUrl;
                return (
                  <Pressable
                    key={d.id}
                    style={({ pressed }) => [
                      styles.kycRow,
                      pressed && canView && styles.kycRowPressed,
                    ]}
                    onPress={() =>
                      canView &&
                      setViewerDoc({
                        type: d.type,
                        fileUrl: d.fileUrl,
                        fileMimeType: d.fileMimeType,
                        fileName: d.fileName,
                      })
                    }
                    disabled={!canView}
                  >
                    <View style={styles.kycLeft}>
                      <Text style={styles.kycType}>{prettyType(d.type)}</Text>
                      {d.numberLast4 ? (
                        <Text style={styles.kycMeta}>•••• {d.numberLast4}</Text>
                      ) : d.numberMasked ? (
                        <Text style={styles.kycMeta}>{d.numberMasked}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.kycBadge, { backgroundColor: c.bg }]}>
                      <Text style={[styles.kycBadgeText, { color: c.fg }]}>
                        {d.status}
                      </Text>
                    </View>
                    {canView ? (
                      <Ionicons
                        name="eye-outline"
                        size={20}
                        color={colors.primary}
                        style={styles.kycViewIcon}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.kycHint}>
              Tap a document to open it full-screen — show it to traffic police
              or building security without leaving the app.
            </Text>
          </>
        )}

        {/* Rider tools — safety & work */}
        <Text style={styles.sectionLabel}>SAFETY & WORK</Text>
        <View style={styles.toolList}>
          <ToolRow
            icon="shield-checkmark-outline"
            label="Safety Centre"
            hint="SOS, emergency contacts, report an incident"
            route="/safety"
            tint={colors.danger}
          />
          <ToolRow
            icon="calendar-outline"
            label="My Shifts"
            hint="Book delivery slots in advance"
            route="/shifts"
          />
          <ToolRow
            icon="options-outline"
            label="Delivery Preferences"
            hint="Auto-accept, batch size, break mode"
            route="/preferences"
          />
        </View>

        {/* Rider tools — growth & support */}
        <Text style={styles.sectionLabel}>GROWTH & SUPPORT</Text>
        <View style={styles.toolList}>
          <ToolRow
            icon="trophy-outline"
            label="My Tier"
            hint="Your standing, perks and progress"
            route="/tier"
            tint={colors.warning}
          />
          <ToolRow
            icon="gift-outline"
            label="Refer & Earn"
            hint="Invite riders, earn bonuses"
            route="/refer"
            tint={colors.success}
          />
          <ToolRow
            icon="school-outline"
            label="Training & Certification"
            hint="Short modules to level up"
            route="/training"
          />
          <ToolRow
            icon="help-buoy-outline"
            label="Help & Support"
            hint="Raise a ticket, browse FAQs"
            route="/support"
          />
        </View>

        {/* Sign out */}
        <Pressable style={styles.signOut} onPress={confirmSignOut}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>Oak &amp; Sizzler Rider</Text>
      </ScrollView>

      <DocumentViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    color: colors.white,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  identityText: { flex: 1 },
  name: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  nameInput: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  phone: { fontSize: font.size.sm, color: colors.textMuted, marginTop: 2 },
  riderTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  riderTypeText: {
    flexShrink: 1,
    fontSize: font.size.xs,
    color: colors.primary,
    fontWeight: font.weight.semibold,
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
  identityBadges: { alignItems: 'flex-end', gap: 6 },

  toolList: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  toolRowPressed: { backgroundColor: colors.primarySoft },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { flex: 1 },
  toolLabel: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  toolHint: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  editLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.md,
  },
  editLinkText: {
    fontSize: font.size.sm,
    color: colors.primary,
    fontWeight: font.weight.semibold,
  },
  editActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  editBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnGhost: { borderWidth: 1, borderColor: colors.border },
  editBtnGhostText: {
    color: colors.textMuted,
    fontWeight: font.weight.semibold,
    fontSize: font.size.sm,
  },
  editBtnPrimary: { backgroundColor: colors.primary },
  editBtnPrimaryText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.sm,
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  kycLoading: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  kycList: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  kycRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kycRowPressed: { backgroundColor: colors.primarySoft },
  kycViewIcon: { marginLeft: spacing.sm },
  kycHint: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  kycLeft: { flex: 1 },
  kycType: {
    fontSize: font.size.md,
    color: colors.text,
    fontWeight: font.weight.medium,
  },
  kycMeta: { fontSize: font.size.sm, color: colors.textMuted, marginTop: 1 },
  kycBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  kycBadgeText: { fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.5 },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyText: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },

  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  signOutText: {
    fontSize: font.size.md,
    color: colors.danger,
    fontWeight: font.weight.semibold,
  },
  version: {
    marginTop: spacing.lg,
    textAlign: 'center',
    fontSize: font.size.xs,
    color: colors.textMuted,
  },
});
