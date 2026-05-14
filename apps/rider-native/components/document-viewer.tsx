/**
 * Full-screen KYC document viewer.
 *
 * Riders open their Aadhaar, driving licence, vehicle insurance or RC right
 * inside the app — so they can show it to traffic police or building security
 * without digging through a gallery. Image documents render inline (contained,
 * pinch-free but full-screen); PDFs and anything non-image hand off to the
 * device's own viewer via Linking. An "Open full document" action is always
 * available for the highest-fidelity / shareable view.
 */
import { Modal, View, Text, Image, Pressable, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE } from '../lib/api';
import { colors, spacing, radius, font } from '../lib/theme';

export interface ViewableDoc {
  type: string;
  fileUrl: string;
  fileMimeType?: string | null;
  fileName?: string | null;
}

function prettyType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Local-storage fileUrls are relative ("/rider-kyc/..."); S3 ones are absolute. */
function absoluteUrl(fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return `${API_BASE}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
}

export function DocumentViewer({
  doc,
  onClose,
}: {
  doc: ViewableDoc | null;
  onClose: () => void;
}) {
  if (!doc) return null;

  const url = absoluteUrl(doc.fileUrl);
  const isImage =
    (doc.fileMimeType ?? '').startsWith('image/') ||
    /\.(jpg|jpeg|png|webp)$/i.test(doc.fileUrl);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {prettyType(doc.type)}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color={colors.white} />
          </Pressable>
        </View>

        {isImage ? (
          <View style={styles.imageWrap}>
            <Image source={{ uri: url }} style={styles.image} resizeMode="contain" />
          </View>
        ) : (
          <View style={styles.fallback}>
            <Ionicons name="document-text-outline" size={56} color={colors.textMuted} />
            <Text style={styles.fallbackText}>
              This document is a {doc.fileMimeType ?? 'file'}. Tap below to open
              it with your device's viewer.
            </Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.openBtn, pressed && styles.openBtnPressed]}
          onPress={() => Linking.openURL(url)}
        >
          <Ionicons name="open-outline" size={18} color={colors.white} />
          <Text style={styles.openBtnText}>Open full document</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0a08' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.white,
    marginRight: spacing.md,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  image: { width: '100%', height: '100%' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  fallbackText: {
    fontSize: font.size.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  openBtnPressed: { backgroundColor: colors.primaryDark },
  openBtnText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
});
