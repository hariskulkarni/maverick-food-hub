/**
 * First-launch walkthrough overlay for the Oak & Sizzler rider app.
 *
 * A full-screen, paged set of intro cards shown once on the very first launch.
 * The "seen" flag is persisted in expo-secure-store under `oas_tour_seen` so
 * it never shows again. A parent screen reads `useTourSeen()` to decide whether
 * to mount <OnboardingTour />.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colors, spacing, radius, font, shadow } from '../lib/theme';

const TOUR_SEEN_KEY = 'oas_tour_seen';

// ─── Persistence helper ──────────────────────────────────────────────────────

interface TourSeenState {
  /** True once the rider has completed or skipped the tour. */
  seen: boolean;
  /** True until the persisted flag has been read on mount. */
  loading: boolean;
  /** Persists the seen flag and flips local state. */
  markSeen: () => Promise<void>;
}

export function useTourSeen(): TourSeenState {
  const [seen, setSeen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await SecureStore.getItemAsync(TOUR_SEEN_KEY);
        if (!cancelled && value === 'true') setSeen(true);
      } catch {
        // Keychain read failed — treat as not-seen; the tour is harmless to repeat.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = useCallback(async () => {
    setSeen(true);
    try {
      await SecureStore.setItemAsync(TOUR_SEEN_KEY, 'true');
    } catch {
      // Best-effort persist; local state still suppresses it this session.
    }
  }, []);

  return { seen, loading, markSeen };
}

// ─── Tour content ────────────────────────────────────────────────────────────

interface Slide {
  icon: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: '🟢',
    title: 'Go online to receive orders',
    body: 'Flip the switch on your dashboard when you start your shift. Delivery requests only reach you while you’re online.',
  },
  {
    icon: '📋',
    title: 'Claim a delivery from the pool',
    body: 'Browse the shared Orders pool and grab the run that suits you. First to claim it gets it — your payout is shown up front.',
  },
  {
    icon: '🗺️',
    title: 'Follow the step-by-step flow',
    body: 'Each delivery walks you through it — head to pickup, collect the food, reach the customer, and confirm with their code.',
  },
  {
    icon: '💸',
    title: 'Track your earnings & streaks',
    body: 'See today’s payout, lifetime totals and your rating any time. Keep delivering to build your streak.',
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface OnboardingTourProps {
  /** When true, the overlay is shown. */
  visible: boolean;
  /** Called after the rider taps Skip or Get started. */
  onClose: () => void;
}

export function OnboardingTour({ visible, onClose }: OnboardingTourProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  // Measured width of the pager itself. The ScrollView sits inside two padded
  // containers, so it's narrower than the window — `pagingEnabled` snaps to
  // THIS width, so each slide must match it exactly or the text gets clipped.
  const [pagerWidth, setPagerWidth] = useState(0);

  const isLast = index === SLIDES.length - 1;

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(SLIDES.length - 1, next));
      if (pagerWidth) {
        scrollRef.current?.scrollTo({ x: clamped * pagerWidth, animated: true });
      }
      setIndex(clamped);
    },
    [pagerWidth]
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!pagerWidth) return;
      const next = Math.round(e.nativeEvent.contentOffset.x / pagerWidth);
      if (next !== index) setIndex(next);
    },
    [index, pagerWidth]
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.topRow}>
            <Text style={styles.brand}>Oak &amp; Sizzler</Text>
            {!isLast ? (
              <Pressable onPress={onClose} hitSlop={10}>
                <Text style={styles.skip}>Skip</Text>
              </Pressable>
            ) : (
              <View style={styles.skipPlaceholder} />
            )}
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScroll}
            onLayout={(e) => setPagerWidth(e.nativeEvent.layout.width)}
            style={styles.pager}
          >
            {SLIDES.map((slide) => (
              <View key={slide.title} style={[styles.slide, { width: pagerWidth }]}>
                <View style={styles.iconBadge}>
                  <Text style={styles.icon}>{slide.icon}</Text>
                </View>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.body}>{slide.body}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.dots}>
            {SLIDES.map((slide, i) => (
              <View
                key={slide.title}
                style={[styles.dot, i === index ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            onPress={() => (isLast ? onClose() : goTo(index + 1))}
          >
            <Text style={styles.ctaText}>{isLast ? 'Get started' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31,27,22,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  brand: {
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  skip: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.textMuted,
  },
  skipPlaceholder: { width: 32 },

  pager: { flexGrow: 0 },
  slide: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  iconBadge: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  icon: { fontSize: 40 },
  title: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  dot: {
    height: 8,
    borderRadius: radius.pill,
    marginHorizontal: 4,
  },
  dotActive: { width: 22, backgroundColor: colors.primary },
  dotInactive: { width: 8, backgroundColor: colors.border },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    ...shadow.card,
  },
  ctaPressed: { backgroundColor: colors.primaryDark },
  ctaText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
});
