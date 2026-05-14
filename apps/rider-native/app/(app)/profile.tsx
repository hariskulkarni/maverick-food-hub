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
  SafeAreaView,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, type KycDoc } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

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

  const loadKyc = useCallback(async () => {
    try {
      const res = await api.kyc();
      setDocs(res.documents);
    } catch {
      setDocs([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await loadKyc();
        if (!cancelled) setKycLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [loadKyc])
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
    <SafeAreaView style={styles.safe}>
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
            </View>
            <View style={styles.riderPill}>
              <Text style={styles.riderPillText}>RIDER</Text>
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
        <Text style={styles.sectionLabel}>VERIFICATION</Text>
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
          <View style={styles.kycList}>
            {docs.map((d) => {
              const c = statusColor(d.status);
              return (
                <View key={d.id} style={styles.kycRow}>
                  <View style={styles.kycLeft}>
                    <Text style={styles.kycType}>{prettyType(d.type)}</Text>
                    {d.numberLast4 ? (
                      <Text style={styles.kycMeta}>•••• {d.numberLast4}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.kycBadge, { backgroundColor: c.bg }]}>
                    <Text style={[styles.kycBadgeText, { color: c.fg }]}>
                      {d.status}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Sign out */}
        <Pressable style={styles.signOut} onPress={confirmSignOut}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>Oak &amp; Sizzler Rider</Text>
      </ScrollView>
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
