/**
 * KYC documents — upload and track the rider's verification documents.
 *
 * The server describes which document types exist, which are required to go
 * online, and which need an expiry date (GET /api/rider/kyc → requirements).
 * Each type gets a status card (Missing / Pending review / Approved / Rejected
 * with the reviewer's reason / Expired / Expiring soon) and an upload form:
 * document number, expiry date where needed, and a file from the camera, the
 * photo library, or a PDF. Uploads go to POST /api/rider/kyc (multipart) and
 * replace any earlier upload of the same type, which resets review to PENDING.
 */
import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { api, ApiError, type KycDoc, type KycGating, type KycRequirement } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const DEFAULT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const EXPIRING_SOON_DAYS = 30;

/** Used only when an older server doesn't send `requirements`. */
const FALLBACK_REQUIREMENTS: KycRequirement[] = [
  { type: 'AADHAAR', label: 'Aadhaar', required: true, needsExpiry: false, numberLabel: 'Aadhaar number', numberPlaceholder: '1234 5678 9012', hint: null },
  { type: 'DRIVING_LICENSE', label: 'Driving licence', required: true, needsExpiry: true, numberLabel: 'Licence number', numberPlaceholder: 'MH1420110012345', hint: null },
  { type: 'VEHICLE_RC', label: 'Vehicle RC', required: true, needsExpiry: true, numberLabel: 'Registration number', numberPlaceholder: 'MH12AB1234', hint: null },
  { type: 'VEHICLE_INSURANCE', label: 'Vehicle insurance', required: true, needsExpiry: true, numberLabel: 'Policy number', numberPlaceholder: 'POL-123456', hint: null },
  { type: 'PAN_CARD', label: 'PAN card', required: false, needsExpiry: false, numberLabel: 'PAN', numberPlaceholder: 'ABCDE1234F', hint: null },
];

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
}

type Badge = { label: string; bg: string; fg: string };

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - Date.now()) / 86_400_000);
}

function badgeFor(doc: KycDoc | undefined): Badge {
  if (!doc) return { label: 'Missing', bg: colors.border, fg: colors.textMuted };
  const d = daysUntil(doc.expiresOn);
  switch (doc.status) {
    case 'APPROVED':
      if (d != null && d < 0) return { label: 'Expired', bg: colors.dangerSoft, fg: colors.danger };
      if (d != null && d <= EXPIRING_SOON_DAYS)
        return { label: `Expires in ${d} day${d === 1 ? '' : 's'}`, bg: colors.warningSoft, fg: colors.warning };
      return { label: 'Approved', bg: colors.successSoft, fg: colors.success };
    case 'PENDING':
      return { label: 'Pending review', bg: colors.warningSoft, fg: colors.warning };
    case 'REJECTED':
      return { label: 'Rejected', bg: colors.dangerSoft, fg: colors.danger };
    case 'EXPIRED':
      return { label: 'Expired', bg: colors.dangerSoft, fg: colors.danger };
    default:
      return { label: doc.status, bg: colors.border, fg: colors.textMuted };
  }
}

/** Valid calendar date in YYYY-MM-DD form. */
function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export default function KycScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<KycDoc[]>([]);
  const [requirements, setRequirements] = useState<KycRequirement[]>(FALLBACK_REQUIREMENTS);
  const [accept, setAccept] = useState<string[]>(DEFAULT_ACCEPT);
  const [maxBytes, setMaxBytes] = useState(DEFAULT_MAX_BYTES);
  const [gating, setGating] = useState<KycGating | null>(null);
  const [openType, setOpenType] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.kyc();
      setDocs(res.documents);
      if (res.requirements?.length) setRequirements(res.requirements);
      if (res.accept?.length) setAccept(res.accept);
      if (res.maxBytes && res.maxBytes > 0) setMaxBytes(res.maxBytes);
      setGating(res.gating ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your documents.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      load().finally(() => {
        if (!cancelled) setLoading(false);
      });
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

  const byType = new Map(docs.map((d) => [d.type, d]));

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="My documents" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {gating && !gating.canGoOnline && gating.message ? (
              <View style={styles.gateCard}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={styles.gateText}>{gating.message}</Text>
              </View>
            ) : (
              <Text style={styles.intro}>
                Upload a clear photo or PDF of each document. Our team reviews new
                uploads, usually within a day.
              </Text>
            )}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {requirements.map((req) => (
              <DocCard
                key={req.type}
                req={req}
                doc={byType.get(req.type)}
                open={openType === req.type}
                onToggle={() => setOpenType((cur) => (cur === req.type ? null : req.type))}
                accept={accept}
                maxBytes={maxBytes}
                onUploaded={async () => {
                  setOpenType(null);
                  await load();
                }}
              />
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function DocCard({
  req,
  doc,
  open,
  onToggle,
  accept,
  maxBytes,
  onUploaded,
}: {
  req: KycRequirement;
  doc: KycDoc | undefined;
  open: boolean;
  onToggle: () => void;
  accept: string[];
  maxBytes: number;
  onUploaded: () => Promise<void>;
}) {
  const badge = badgeFor(doc);
  const [number, setNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function acceptFile(f: PickedFile): boolean {
    if (!accept.includes(f.mimeType)) {
      setFormError('Use a JPG, PNG, WebP photo or a PDF.');
      return false;
    }
    if (f.size != null && f.size > maxBytes) {
      setFormError(`That file is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).`);
      return false;
    }
    setFormError(null);
    setFile(f);
    return true;
  }

  async function pickImage(source: 'camera' | 'library') {
    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          source === 'camera' ? 'Camera permission needed' : 'Photo permission needed',
          'Enable access in Settings to add your document.'
        );
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      const a = result.canceled ? null : result.assets[0];
      if (!a) return;
      const mimeType = a.mimeType && a.mimeType !== 'image/jpg' ? a.mimeType : 'image/jpeg';
      acceptFile({
        uri: a.uri,
        name: a.fileName || `${req.type.toLowerCase()}.${extFor(mimeType)}`,
        mimeType,
        size: a.fileSize ?? null,
      });
    } catch {
      Alert.alert('Could not open the camera', 'Please try again.');
    }
  }

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      const a = result.canceled ? null : result.assets[0];
      if (!a) return;
      acceptFile({
        uri: a.uri,
        name: a.name || `${req.type.toLowerCase()}.pdf`,
        mimeType: a.mimeType || 'application/pdf',
        size: a.size ?? null,
      });
    } catch {
      Alert.alert('Could not open files', 'Please try again.');
    }
  }

  async function submit() {
    if (uploading) return;
    const num = number.trim();
    if (!num) {
      setFormError(`Enter your ${req.numberLabel.toLowerCase()}.`);
      return;
    }
    const exp = expiresOn.trim();
    if (req.needsExpiry && !exp) {
      setFormError('Enter the expiry date (YYYY-MM-DD).');
      return;
    }
    if (exp && !isIsoDate(exp)) {
      setFormError('Expiry date must look like 2027-03-31.');
      return;
    }
    if (exp && new Date(`${exp}T23:59:59`).getTime() < Date.now()) {
      setFormError('This document has already expired — upload a valid one.');
      return;
    }
    if (!file) {
      setFormError('Add a photo or PDF of the document.');
      return;
    }
    setUploading(true);
    setFormError(null);
    try {
      await api.uploadKyc({ type: req.type, number: num, expiresOn: exp || null, file });
      setNumber('');
      setExpiresOn('');
      setFile(null);
      Alert.alert('Uploaded', `${req.label} submitted for review.`);
      await onUploaded();
    } catch (e) {
      setFormError(
        e instanceof ApiError
          ? e.status === 0
            ? "You're offline — nothing was uploaded. Try again when connected."
            : e.message
          : 'Upload failed. Please try again.'
      );
    } finally {
      setUploading(false);
    }
  }

  const actionLabel = !doc ? 'Upload' : doc.status === 'REJECTED' || doc.status === 'EXPIRED' ? 'Re-upload' : 'Replace';

  return (
    <View style={styles.card}>
      <Pressable style={styles.cardHead} onPress={onToggle} hitSlop={4}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>
            {req.label}
            {req.required ? <Text style={styles.required}> · required</Text> : null}
          </Text>
          {doc?.numberLast4 ? <Text style={styles.cardMeta}>•••• {doc.numberLast4}</Text> : null}
          {doc?.expiresOn ? (
            <Text style={styles.cardMeta}>Expires {String(doc.expiresOn).slice(0, 10)}</Text>
          ) : null}
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </Pressable>

      {doc?.status === 'REJECTED' && doc.rejectionReason ? (
        <Text style={styles.rejectText}>Reason: {doc.rejectionReason}</Text>
      ) : null}
      {req.hint ? <Text style={styles.hint}>{req.hint}</Text> : null}

      {!open ? (
        <Pressable style={styles.toggleBtn} onPress={onToggle}>
          <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
          <Text style={styles.toggleText}>{actionLabel}</Text>
        </Pressable>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>{req.numberLabel}</Text>
          <TextInput
            style={styles.input}
            value={number}
            onChangeText={(t) => setNumber(t.slice(0, 40))}
            placeholder={req.numberPlaceholder}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!uploading}
          />
          {req.needsExpiry ? (
            <>
              <Text style={styles.label}>Expiry date</Text>
              <TextInput
                style={styles.input}
                value={expiresOn}
                onChangeText={(t) => setExpiresOn(t.replace(/[^0-9-]/g, '').slice(0, 10))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                editable={!uploading}
              />
            </>
          ) : null}

          <Text style={styles.label}>Document file</Text>
          <View style={styles.sourceRow}>
            <SourceButton icon="camera-outline" label="Camera" onPress={() => pickImage('camera')} disabled={uploading} />
            <SourceButton icon="images-outline" label="Gallery" onPress={() => pickImage('library')} disabled={uploading} />
            {accept.includes('application/pdf') ? (
              <SourceButton icon="document-outline" label="PDF" onPress={pickPdf} disabled={uploading} />
            ) : null}
          </View>
          {file ? (
            <View style={styles.fileRow}>
              <Ionicons
                name={file.mimeType === 'application/pdf' ? 'document-text' : 'image'}
                size={16}
                color={colors.success}
              />
              <Text style={styles.fileName} numberOfLines={1}>
                {file.name}
              </Text>
            </View>
          ) : null}

          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

          <View style={styles.formActions}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onToggle} disabled={uploading}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.btnPrimary, uploading && styles.btnDisabled]}
              onPress={submit}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.btnPrimaryText}>Submit</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function SourceButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.sourceBtn, pressed && styles.sourceBtnPressed]}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.sourceText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  intro: { fontSize: font.size.sm, color: colors.textMuted, lineHeight: 20 },
  gateCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  gateText: { flex: 1, fontSize: font.size.sm, color: colors.danger, lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  required: { fontSize: font.size.xs, fontWeight: font.weight.medium, color: colors.textMuted },
  cardMeta: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: font.size.xs, fontWeight: font.weight.semibold },
  rejectText: { marginTop: spacing.sm, fontSize: font.size.sm, color: colors.danger },
  hint: { marginTop: spacing.sm, fontSize: font.size.xs, color: colors.textMuted, lineHeight: 18 },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  toggleText: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: colors.primary },
  form: { marginTop: spacing.sm },
  label: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: font.size.md,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  sourceRow: { flexDirection: 'row', gap: spacing.sm },
  sourceBtn: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  sourceBtnPressed: { backgroundColor: colors.primarySoft },
  sourceText: { fontSize: font.size.xs, color: colors.text, fontWeight: font.weight.medium },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  fileName: { flex: 1, fontSize: font.size.sm, color: colors.text },
  errorText: { marginTop: spacing.sm, fontSize: font.size.sm, color: colors.danger },
  formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  btnGhostText: { fontSize: font.size.md, color: colors.text, fontWeight: font.weight.semibold },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { fontSize: font.size.md, color: colors.white, fontWeight: font.weight.bold },
  btnDisabled: { opacity: 0.6 },
});
