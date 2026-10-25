/**
 * Training certificates — every certificate the rider has earned, newest
 * first. A certificate for an older module version is shown as superseded
 * (the module was updated and needs re-certification). Cached for offline.
 *
 * Wired to GET /api/rider/training/certificates.
 */
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { ScreenHeader } from '../components/screen-header';
import { growth, type TrainingCertificate } from '../lib/api-growth';
import { cacheKeys, getTrainingLang, readCache, savedAgo, writeCache } from '../lib/training-cache';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

export default function TrainingCertificatesScreen() {
  const [certs, setCerts] = useState<TrainingCertificate[] | null>(null);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { certificates } = await growth.certificates(await getTrainingLang());
      setCerts(certificates);
      setOfflineSince(null);
      writeCache(cacheKeys.certificates(), certificates);
    } catch (e) {
      const cached = await readCache<TrainingCertificate[]>(cacheKeys.certificates());
      if (cached) {
        setCerts(cached.data);
        setOfflineSince(cached.savedAt);
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not load your certificates.');
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Certificates" />
      {!certs && !error ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !certs ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.muted}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        >
          {offlineSince ? <Text style={styles.muted}>Offline. Saved {savedAgo(offlineSince)}.</Text> : null}
          {certs.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="ribbon-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No certificates yet</Text>
              <Text style={styles.muted}>Finish a module and pass its quiz to earn one.</Text>
            </View>
          ) : (
            certs.map((c) => (
              <View key={c.id} style={[styles.card, !c.isCurrent && styles.cardOld]}>
                <Ionicons name="ribbon" size={30} color={c.isCurrent ? colors.success : colors.textMuted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.title}>{c.moduleTitle}</Text>
                  <Text style={styles.meta}>
                    Issued {new Date(c.issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · version {c.moduleVersion}
                    {c.scorePct !== null ? ` · ${c.scorePct}%` : ''}
                  </Text>
                  <Text style={styles.code}>{c.code}</Text>
                  {!c.isCurrent ? <Text style={styles.old}>Module updated to version {c.currentVersion}. Re-certify to stay current.</Text> : null}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  scroll: { padding: spacing.lg, gap: spacing.md },
  muted: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.success, padding: spacing.lg, ...shadow.card },
  cardOld: { borderColor: colors.border, opacity: 0.8 },
  title: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  meta: { fontSize: font.size.xs, color: colors.textMuted },
  code: { fontSize: font.size.sm, color: colors.text, fontFamily: 'monospace', marginTop: 2 },
  old: { fontSize: font.size.xs, color: colors.danger, marginTop: 2 },
});
