/**
 * Customer Feedback — the rider's own delivery ratings.
 *
 * Wired to GET /api/rider/feedback. The server already redacts the payload to
 * delivery rating + a comment only when the customer opted in to sharing it;
 * this screen renders exactly those fields and nothing else.
 */
import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../lib/api';
import { growth, type RiderFeedbackResponse } from '../lib/api-growth';
import { colors, spacing, radius, font } from '../lib/theme';
import { ScreenHeader } from '../components/screen-header';

export default function CustomerFeedbackScreen() {
  const [data, setData] = useState<RiderFeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await growth.feedback());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load feedback.');
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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScreenHeader title="Customer Feedback" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.muted}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => { setLoading(true); load().then(() => setLoading(false)); }}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data?.rows ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          ListHeaderComponent={
            data?.summary ? (
              <View style={styles.summary}>
                <Text style={styles.avg}>
                  {data.summary.avgDelivery != null ? data.summary.avgDelivery.toFixed(1) : '-'} ★
                </Text>
                <Text style={styles.muted}>
                  Average delivery rating across {data.summary.count} review{data.summary.count === 1 ? '' : 's'}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={<Text style={[styles.muted, styles.empty]}>No customer feedback yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.rating}>
                {item.deliveryRating != null ? `${item.deliveryRating} ★` : 'No delivery rating'}
              </Text>
              {item.comment ? <Text style={styles.comment}>&ldquo;{item.comment}&rdquo;</Text> : null}
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  summary: { alignItems: 'center', marginBottom: spacing.lg, gap: spacing.xs },
  avg: { fontSize: font.size.xl, fontWeight: font.weight.bold, color: colors.text },
  muted: { fontSize: font.size.sm, color: colors.textMuted, textAlign: 'center' },
  empty: { marginTop: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  rating: { fontSize: font.size.md, fontWeight: font.weight.bold, color: colors.text },
  comment: { fontSize: font.size.sm, color: colors.text, lineHeight: 20 },
  date: { fontSize: font.size.xs, color: colors.textMuted },
  retry: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  retryText: { color: colors.white, fontWeight: font.weight.bold },
});
