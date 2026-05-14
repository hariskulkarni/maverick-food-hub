/**
 * Emergency Contacts — manage who gets alerted when the rider triggers SOS.
 *
 * List with a primary badge, an add form (name / phone / relation / primary),
 * inline edit, and delete (confirmed via Alert). Strong empty state nudging the
 * rider to add at least one contact before they start riding.
 *
 * Full-screen route with its own back header.
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
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { safety, type EmergencyContact, type ContactInput } from '../lib/api-safety';
import { ScreenHeader } from '../components/screen-header';
import { ApiError } from '../lib/api';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

interface FormState {
  name: string;
  phone: string;
  relation: string;
  isPrimary: boolean;
}

const EMPTY_FORM: FormState = { name: '', phone: '', relation: '', isPrimary: false };

export default function EmergencyContactsScreen() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await safety.contacts();
      setContacts(res.contacts);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load contacts.');
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

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(c: EmergencyContact) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone,
      relation: c.relation ?? '',
      isPrimary: c.isPrimary,
    });
  }

  async function submit() {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) {
      Alert.alert('Name needed', 'Please enter the contact’s name.');
      return;
    }
    if (!phone) {
      Alert.alert('Phone needed', 'Please enter a phone number we can reach.');
      return;
    }
    setSaving(true);
    try {
      const payload: ContactInput = {
        name,
        phone,
        relation: form.relation.trim() || undefined,
        isPrimary: form.isPrimary,
      };
      if (editingId) {
        await safety.updateContact(editingId, payload);
      } else {
        await safety.addContact(payload);
      }
      await load();
      resetForm();
    } catch (e) {
      Alert.alert(
        'Could not save',
        e instanceof ApiError ? e.message : 'Please try again.'
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(c: EmergencyContact) {
    Alert.alert('Remove contact', `Remove ${c.name} from your emergency contacts?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(c.id);
          try {
            await safety.deleteContact(c.id);
            if (editingId === c.id) resetForm();
            await load();
          } catch (e) {
            Alert.alert(
              'Could not remove',
              e instanceof ApiError ? e.message : 'Please try again.'
            );
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Emergency Contacts" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            When you trigger SOS, we alert your primary contact with your live
            location. Add at least one person you trust.
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={() => {
                  setLoading(true);
                  load().finally(() => setLoading(false));
                }}
              >
                <Text style={styles.retryText}>Tap to retry</Text>
              </Pressable>
            </View>
          ) : contacts.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="person-add-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No contacts yet</Text>
              <Text style={styles.emptyBody}>
                Add a family member or friend below. They’ll be the first person
                we reach if you ever need help on the road.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {contacts.map((c) => (
                <View key={c.id} style={styles.contactRow}>
                  <View style={styles.contactAvatar}>
                    <Text style={styles.contactAvatarText}>
                      {c.name.trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                  <View style={styles.contactInfo}>
                    <View style={styles.contactNameRow}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      {c.isPrimary ? (
                        <View style={styles.primaryBadge}>
                          <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.contactMeta}>
                      {c.phone}
                      {c.relation ? ` · ${c.relation}` : ''}
                    </Text>
                  </View>
                  <View style={styles.contactActions}>
                    <Pressable
                      onPress={() => startEdit(c)}
                      hitSlop={8}
                      style={styles.iconBtn}
                    >
                      <Ionicons name="pencil" size={18} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => confirmDelete(c)}
                      hitSlop={8}
                      style={styles.iconBtn}
                      disabled={deletingId === c.id}
                    >
                      {deletingId === c.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      )}
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Add / edit form */}
          <Text style={styles.sectionLabel}>
            {editingId ? 'EDIT CONTACT' : 'ADD A CONTACT'}
          </Text>
          <View style={styles.formCard}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
              placeholder="e.g. Priya Sharma"
              placeholderTextColor={colors.textMuted}
              maxLength={80}
            />

            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={form.phone}
              onChangeText={(t) => setForm((f) => ({ ...f, phone: t }))}
              placeholder="e.g. +91 98765 43210"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              maxLength={20}
            />

            <Text style={styles.fieldLabel}>Relationship (optional)</Text>
            <TextInput
              style={styles.input}
              value={form.relation}
              onChangeText={(t) => setForm((f) => ({ ...f, relation: t }))}
              placeholder="e.g. Spouse, Parent, Friend"
              placeholderTextColor={colors.textMuted}
              maxLength={40}
            />

            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>Set as primary contact</Text>
                <Text style={styles.switchSub}>
                  The first person we alert during an SOS
                </Text>
              </View>
              <Switch
                value={form.isPrimary}
                onValueChange={(v) => setForm((f) => ({ ...f, isPrimary: v }))}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            </View>

            <View style={styles.formActions}>
              {editingId ? (
                <Pressable
                  style={[styles.formBtn, styles.formBtnGhost]}
                  onPress={resetForm}
                  disabled={saving}
                >
                  <Text style={styles.formBtnGhostText}>Cancel</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.formBtn, styles.formBtnPrimary]}
                onPress={submit}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.formBtnPrimaryText}>
                    {editingId ? 'Save changes' : 'Add contact'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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

  loadingBox: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { fontSize: font.size.sm, color: colors.danger, lineHeight: 20 },
  retryText: {
    marginTop: spacing.sm,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.danger,
  },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: 'center',
  },

  list: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  contactInfo: { flex: 1 },
  contactNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  contactName: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  contactMeta: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  primaryBadge: {
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  primaryBadgeText: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.success,
    letterSpacing: 0.8,
  },
  contactActions: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  fieldLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    fontSize: font.size.md,
    color: colors.text,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  switchText: { flex: 1 },
  switchLabel: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  switchSub: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  formBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBtnGhost: { borderWidth: 1, borderColor: colors.border },
  formBtnGhostText: {
    color: colors.textMuted,
    fontWeight: font.weight.semibold,
    fontSize: font.size.md,
  },
  formBtnPrimary: { backgroundColor: colors.primary, ...shadow.card },
  formBtnPrimaryText: {
    color: colors.white,
    fontWeight: font.weight.bold,
    fontSize: font.size.md,
  },
});
