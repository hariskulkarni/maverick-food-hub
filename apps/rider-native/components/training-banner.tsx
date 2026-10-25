/**
 * "Required training" banner for the home screen. Shows when the rider has
 * required modules without a current certificate (new, overdue or updated).
 * Uses the cached library so it also shows offline; refreshes on focus.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { growth, type TrainingResponse } from '../lib/api-growth';
import { cacheKeys, getTrainingLang, readCache, writeCache } from '../lib/training-cache';
import { colors, font, radius, spacing } from '../lib/theme';

export function TrainingBanner() {
  const [data, setData] = useState<TrainingResponse | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const lang = await getTrainingLang();
        const cached = await readCache<TrainingResponse>(cacheKeys.library(lang));
        if (cached && !cancelled) setData(cached.data);
        try {
          const fresh = await growth.training(lang);
          writeCache(cacheKeys.library(lang), fresh);
          if (!cancelled) setData(fresh);
        } catch {
          // Offline / server hiccup: keep whatever the cache had.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const remaining = data?.requiredRemaining ?? 0;
  if (remaining === 0) return null;
  const overdue = data?.requiredOverdue ?? 0;
  const blocking = (data?.modules ?? []).some((m) => m.isRequired && m.blocksShift && !m.completed);

  return (
    <Pressable
      onPress={() => router.push('/training')}
      style={({ pressed }) => [styles.wrap, overdue > 0 && styles.wrapDanger, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
    >
      <Ionicons name="school" size={22} color={overdue > 0 ? colors.danger : colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {remaining} required training module{remaining === 1 ? '' : 's'} {overdue > 0 ? `(${overdue} overdue)` : 'pending'}
        </Text>
        <Text style={styles.body}>
          {blocking ? 'Includes safety training that may be needed before you go online.' : 'Tap to continue your training.'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, backgroundColor: colors.warningSoft, borderColor: colors.warning, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  wrapDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  title: { fontSize: font.size.sm, fontWeight: font.weight.bold, color: colors.text },
  body: { fontSize: font.size.xs, color: colors.textMuted, marginTop: 2 },
});
