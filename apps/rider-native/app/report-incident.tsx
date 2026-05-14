/**
 * Report an Incident — file a safety report from the road.
 *
 * Type picker (chips for the IncidentType enum), a description text area, an
 * optional photo via expo-image-picker (camera or library — graceful if the
 * permission is denied), and an auto-attached GPS fix. On submit it confirms,
 * shows a success Alert, and refreshes the rider's past reports below.
 *
 * NOTE: photo upload isn't wired to storage in this build — the captured image
 * is shown locally for reassurance, but `photoUrl` is left undefined on submit.
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
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  safety,
  type IncidentReport,
  type IncidentType,
  type IncidentStatus,
} from '../lib/api-safety';
import { ApiError } from '../lib/api';
import { colors, spacing, radius, font, shadow } from '../lib/theme';
import { ScreenHeader } from '../components/screen-header';

const INCIDENT_TYPES: { value: IncidentType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'ACCIDENT', label: 'Accident', icon: 'medkit-outline' },
  { value: 'HARASSMENT', label: 'Harassment', icon: 'hand-left-outline' },
  { value: 'VEHICLE_BREAKDOWN', label: 'Vehicle breakdown', icon: 'build-outline' },
  { value: 'THEFT', label: 'Theft', icon: 'lock-closed-outline' },
  { value: 'UNSAFE_LOCATION', label: 'Unsafe location', icon: 'warning-outline' },
  { value: 'CUSTOMER_DISPUTE', label: 'Customer dispute', icon: 'chatbubble-ellipses-outline' },
  { value: 'OTHER', label: 'Something else', icon: 'ellipsis-horizontal-circle-outline' },
];

const TYPE_LABEL: Record<IncidentType, string> = INCIDENT_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.value]: t.label }),
  {} as Record<IncidentType, string>
);

const STATUS_META: Record<IncidentStatus, { label: string; bg: string; fg: string }> = {
  OPEN: { label: 'Open', bg: '#fdf0e0', fg: colors.warning },
  UNDER_REVIEW: { label: 'Under review', bg: colors.primarySoft, fg: colors.primaryDark },
  RESOLVED: { label: 'Resolved', bg: colors.successSoft, fg: colors.success },
  CLOSED: { label: 'Closed', bg: colors.successSoft, fg: colors.success },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReportIncidentScreen() {
  const [type, setType] = useState<IncidentType | null>(null);
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [past, setPast] = useState<IncidentReport[]>([]);
  const [pastLoading, setPastLoading] = useState(true);

  const loadPast = useCallback(async () => {
    try {
      const res = await safety.incidents();
      setPast(res.incidents);
    } catch {
      // Past reports are non-critical — leave the list as-is on a network blip.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await loadPast();
        if (!cancelled) setPastLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [loadPast])
  );

  function choosePhoto() {
    Alert.alert('Add a photo', 'Attach a photo to help support understand what happened.', [
      { text: 'Take photo', onPress: () => capture('camera') },
      { text: 'Choose from library', onPress: () => capture('library') },
      ...(photoUri
        ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: () => setPhotoUri(null) }]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function capture(source: 'camera' | 'library') {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Camera permission needed',
            'Enable camera access in Settings to attach a photo. You can still submit without one.'
          );
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          allowsEditing: false,
        });
        if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Photo permission needed',
            'Enable photo access in Settings to attach an image. You can still submit without one.'
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          allowsEditing: false,
        });
        if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Could not open camera', 'Please try again, or submit without a photo.');
    }
  }

  /** Best-effort one-shot GPS fix — never throws. */
  async function getFix(): Promise<{ lat: number; lng: number } | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    } catch {
      return null;
    }
  }

  function confirmSubmit() {
    if (submitting) return;
    if (!type) {
      Alert.alert('Pick a type', 'Tell us what kind of incident this is.');
      return;
    }
    const desc = description.trim();
    if (desc.length < 10) {
      Alert.alert(
        'Add more detail',
        'Please describe what happened in a sentence or two so support can act on it.'
      );
      return;
    }
    Alert.alert(
      'Submit this report?',
      'Our safety team will review it and reach out if they need more information.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit report', onPress: submit },
      ]
    );
  }

  async function submit() {
    if (!type) return;
    setSubmitting(true);
    try {
      const fix = await getFix();
      await safety.reportIncident({
        type,
        description: description.trim(),
        lat: fix?.lat,
        lng: fix?.lng,
        // Photo upload to storage isn't wired in this build — submit without it.
        photoUrl: undefined,
      });
      await loadPast();
      setType(null);
      setDescription('');
      setPhotoUri(null);
      Alert.alert(
        'Report submitted',
        'Thank you for flagging this. Our safety team has it and will follow up if needed.'
      );
    } catch (e) {
      Alert.alert(
        'Could not submit',
        e instanceof ApiError ? e.message : 'Please check your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Report an Incident" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            Flag anything that affected your safety or the delivery. Your current
            location is attached automatically.
          </Text>

          {/* Type picker */}
          <Text style={styles.sectionLabel}>WHAT HAPPENED?</Text>
          <View style={styles.chipWrap}>
            {INCIDENT_TYPES.map((t) => {
              const selected = type === t.value;
              return (
                <Pressable
                  key={t.value}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setType(t.value)}
                >
                  <Ionicons
                    name={t.icon}
                    size={16}
                    color={selected ? colors.white : colors.primary}
                  />
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Description */}
          <Text style={styles.sectionLabel}>DESCRIBE IT</Text>
          <TextInput
            style={styles.textArea}
            value={description}
            onChangeText={setDescription}
            placeholder="What happened, where, and who was involved? The more detail, the faster we can help."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={1000}
          />
          <Text style={styles.charCount}>{description.length}/1000</Text>

          {/* Optional photo */}
          <Text style={styles.sectionLabel}>PHOTO (OPTIONAL)</Text>
          {photoUri ? (
            <Pressable style={styles.photoPreviewWrap} onPress={choosePhoto}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              <View style={styles.photoOverlay}>
                <Ionicons name="camera-reverse-outline" size={18} color={colors.white} />
                <Text style={styles.photoOverlayText}>Change or remove</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable style={styles.photoButton} onPress={choosePhoto}>
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
              <Text style={styles.photoButtonText}>Add a photo</Text>
            </Pressable>
          )}

          {/* Submit */}
          <Pressable
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={confirmSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.submitBtnText}>Submit report</Text>
            )}
          </Pressable>

          {/* Past reports */}
          <Text style={styles.sectionLabel}>MY PAST REPORTS</Text>
          {pastLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : past.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                You haven’t filed any incident reports. That’s a good thing —
                ride safe out there.
              </Text>
            </View>
          ) : (
            <View style={styles.pastList}>
              {past.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <View key={r.id} style={styles.pastRow}>
                    <View style={styles.pastTop}>
                      <Text style={styles.pastType}>{TYPE_LABEL[r.type] ?? r.type}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.statusBadgeText, { color: meta.fg }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.pastDesc} numberOfLines={3}>
                      {r.description}
                    </Text>
                    <Text style={styles.pastDate}>{formatDate(r.createdAt)}</Text>
                    {r.resolution ? (
                      <View style={styles.resolutionBox}>
                        <Text style={styles.resolutionLabel}>SAFETY TEAM</Text>
                        <Text style={styles.resolutionText}>{r.resolution}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
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
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.text,
  },
  chipTextSelected: { color: colors.white },

  textArea: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 120,
    fontSize: font.size.md,
    color: colors.text,
    lineHeight: 22,
  },
  charCount: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: spacing.xs,
  },

  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.card,
  },
  photoButtonText: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    color: colors.primary,
  },
  photoPreviewWrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPreview: { width: '100%', height: 200 },
  photoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(31,27,22,0.72)',
  },
  photoOverlayText: {
    color: colors.white,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },

  submitBtn: {
    marginTop: spacing.xl,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },

  loadingBox: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
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

  pastList: {
    gap: spacing.md,
  },
  pastRow: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  pastTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  pastType: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 0.5,
  },
  pastDesc: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
    marginTop: 2,
  },
  pastDate: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  resolutionBox: {
    marginTop: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  resolutionLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.success,
    letterSpacing: 1,
    marginBottom: 2,
  },
  resolutionText: {
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 19,
  },
});
