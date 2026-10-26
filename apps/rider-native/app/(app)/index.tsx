/**
 * Dashboard — the rider's home screen.
 *
 *   - Online / offline toggle (POST /api/rider/online). While online we ping
 *     /api/rider/heartbeat every 30s so the server's auto-offline sweep keeps
 *     us live, and (with "Allow all the time") background tracking keeps the
 *     rider live while the phone is locked. If the server set us offline while
 *     the app was away, the next heartbeat / resume says so and the toggle
 *     follows, with an explanation.
 *   - Current delivery card — the active assignment, if any.
 *   - Pull-to-refresh.
 *
 * The accept / pickup / deliver action buttons live on the dedicated delivery
 * screen (next task) — this screen just surfaces status at a glance.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Switch,
  ActivityIndicator,
  Alert,
  AppState,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, ApiError, type Assignment, type AssignmentStatus, type KycGating, type RiderMe } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';
import { orderHold } from '../../lib/order-hold';
import { OnboardingTour, useTourSeen } from '../../components/onboarding-tour';
import { SurgeBanner } from '../../components/surge-banner';
import { TrainingBanner } from '../../components/training-banner';
import { BreakModeCard } from '../../components/break-mode-card';
import { useRiderLocation } from '../../lib/use-rider-location';
import { pickTrackedOrderId, syncDeliveryTracking } from '../../lib/delivery-tracking';
import { hasBackgroundPermission, stopDeliveryTracking } from '../../lib/background-location';

/** A square quick-action tile on the dashboard. */
function QuickAction({
  icon,
  label,
  route,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  route: string;
  tint: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}
      onPress={() => router.push(route as never)}
    >
      <View style={[styles.quickIcon, { backgroundColor: tint + '1a' }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const HEARTBEAT_MS = 30_000;

function rupees(decimalString: string): string {
  const n = Number.parseFloat(decimalString);
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

/** "just now" / "12s ago" / "3m ago" — keeps the sync indicator human-readable. */
function relativeTime(from: number, now: number): string {
  const secs = Math.max(0, Math.round((now - from) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

const STATUS_META: Record<
  AssignmentStatus,
  { label: string; bg: string; fg: string }
> = {
  PENDING: { label: 'New request', bg: '#fdf0e0', fg: colors.warning },
  ACCEPTED: { label: 'Heading to pickup', bg: colors.primarySoft, fg: colors.primaryDark },
  PICKED_UP: { label: 'Out for delivery', bg: colors.successSoft, fg: colors.success },
  DELIVERED: { label: 'Delivered', bg: colors.successSoft, fg: colors.success },
  REJECTED: { label: 'Rejected', bg: colors.dangerSoft, fg: colors.danger },
  CANCELLED: { label: 'Cancelled', bg: colors.dangerSoft, fg: colors.danger },
};

const HOLD_META = {
  unreachable: { label: 'Customer unreachable', bg: '#fdf0e0', fg: colors.warning },
  closed: { label: 'Closed by support', bg: colors.dangerSoft, fg: colors.danger },
} as const;

function StatusBadge({ a }: { a: Assignment }) {
  const hold = orderHold(a);
  const meta = hold ? HOLD_META[hold] : STATUS_META[a.status];
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.badgeText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

function AssignmentCard({ a }: { a: Assignment }) {
  const o = a.order;
  const itemCount = o.items.reduce((sum, it) => sum + (it.quantity ?? 1), 0);
  const drop = o.address ? `${o.address.line1}, ${o.address.city}` : 'Customer address';

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.orderCode} numberOfLines={1}>
          {o.code}
        </Text>
        <StatusBadge a={a} />
      </View>

      <View style={styles.route}>
        <View style={styles.routeRow}>
          <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
          <View style={styles.routeText}>
            <Text style={styles.routeLabel}>PICKUP</Text>
            <Text style={styles.routeValue} numberOfLines={1}>
              {o.branch?.restaurantName ?? o.branch?.name ?? 'Restaurant'}
            </Text>
            {o.branch?.restaurantName && o.branch?.name ? (
              <Text style={styles.routeSub} numberOfLines={1}>
                {o.branch.name}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.routeConnector} />
        <View style={styles.routeRow}>
          <View style={[styles.routeDot, { backgroundColor: colors.success }]} />
          <View style={styles.routeText}>
            <Text style={styles.routeLabel}>DROP</Text>
            <Text style={styles.routeValue} numberOfLines={1}>
              {drop}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.metaText}>
          {itemCount} item{itemCount === 1 ? '' : 's'} · {rupees(o.total)}
        </Text>
        <Text style={styles.earnings}>You earn {rupees(a.earningsAmt)}</Text>
      </View>
    </View>
  );
}

/** Shown once per app session when the server set the rider offline behind their back. */
let setOfflineNoticeShown = false;
function notifySetOffline() {
  if (setOfflineNoticeShown) return;
  setOfflineNoticeShown = true;
  Alert.alert(
    'You were set offline',
    'Flavrly could not reach your app for over 2 minutes, so you were taken offline and will not get new orders. Go online again when you are ready. To stay online with your phone locked, allow location "All the time".'
  );
}

/** Background-location disclosure: offered once per session when going online without it. */
let backgroundOfferShown = false;
async function offerBackgroundLocation() {
  if (backgroundOfferShown) return;
  try {
    if (await hasBackgroundPermission()) return;
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.canAskAgain) return;
    backgroundOfferShown = true;
    router.push('/location-disclosure');
  } catch {
    // Permission APIs unavailable — foreground tracking still works.
  }
}

export default function DashboardScreen() {
  const { rider, signOut } = useAuth();
  const router = useRouter();
  const [online, setOnline] = useState(false);
  // KYC gate: when required documents are missing/expired the server refuses
  // to put the rider online — surface why next to the toggle.
  const [kycGate, setKycGate] = useState<KycGating | null>(null);
  const [me, setMe] = useState<RiderMe | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest known online flag for callbacks that outlive a render (heartbeat, resume).
  const onlineRef = useRef(false);
  useEffect(() => {
    onlineRef.current = online;
  }, [online]);

  // "Last synced" indicator — set whenever data lands or the heartbeat fires,
  // and ticked on an interval so the relative label stays fresh.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // First-launch onboarding.
  const { seen: tourSeen, loading: tourLoading, markSeen: markTourSeen } = useTourSeen();
  const showTour = !tourLoading && !tourSeen;

  // Stream GPS the whole time the rider is online — not just on an active
  // delivery — so the super-admin fleet map always has a live position.
  // Pings are tagged with the active delivery (if any) so the customer tracker
  // updates even before the rider opens the delivery screen.
  useRiderLocation({ orderId: pickTrackedOrderId(assignments), enabled: online });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [meRes, list] = await Promise.all([api.me(), api.assignments()]);
      if (onlineRef.current && !meRes.online) notifySetOffline();
      setOnline(meRes.online);
      setMe(meRes);
      setAssignments(list);
      setLastSyncedAt(Date.now());
      // Start / retarget / stop background delivery tracking to match.
      void syncDeliveryTracking(list, meRes.online);
      // Best-effort — an older server without gating simply shows nothing.
      api
        .kyc()
        .then((k) => setKycGate(k.gating ?? null))
        .catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your dashboard.');
    }
  }, []);

  // Refetch whenever the Home tab gains focus — so a freshly claimed order
  // appears the moment the rider lands back here from the pool.
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

  // Heartbeat — runs only while online. Each successful ping refreshes the
  // "last synced" stamp so the indicator visibly tracks the 30s loop.
  const sendHeartbeat = useCallback(async () => {
    try {
      const gps = await Location.hasServicesEnabledAsync().catch(() => true);
      const res = await api.heartbeat(gps);
      setLastSyncedAt(Date.now());
      // The server set us offline (e.g. the app was away for >2 min without
      // background location): follow it instead of showing a false "Online".
      if (res && res.online === false && onlineRef.current) {
        notifySetOffline();
        setOnline(false);
        void stopDeliveryTracking();
      }
    } catch {
      // Network blip — the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (online) {
      void sendHeartbeat();
      heartbeatRef.current = setInterval(() => {
        void sendHeartbeat();
      }, HEARTBEAT_MS);
    }
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [online, sendHeartbeat]);

  // Back in the foreground: refresh at once (heartbeat timers don't run while
  // the phone is asleep) so the toggle shows the server's real state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void load();
      if (onlineRef.current) void sendHeartbeat();
    });
    return () => sub.remove();
  }, [load, sendHeartbeat]);

  // Re-render the relative "synced Ns ago" label once a second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function toggleOnline(next: boolean) {
    if (toggling) return;
    // Tactile confirmation the moment the rider flips their status.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setToggling(true);
    setOnline(next); // optimistic
    try {
      await api.setOnline(next);
      if (!next) {
        // Going offline ends all background tracking.
        void stopDeliveryTracking();
      } else {
        // Keep the rider live while the phone is locked / in another app.
        const running = await syncDeliveryTracking(assignments, true);
        if (!running) void offerBackgroundLocation();
      }
    } catch (e) {
      setOnline(!next); // revert on failure
      if (e instanceof ApiError && e.status === 409 && (e.body as { code?: string } | null)?.code === 'training/required') {
        // Platform training gate: required safety modules must be passed first.
        Alert.alert('Training required', e.message, [
          { text: 'Later', style: 'cancel' },
          { text: 'Open training', onPress: () => router.push('/training') },
        ]);
      } else if (e instanceof ApiError && e.status === 409 && (e.body as { error?: string } | null)?.error === 'kyc_incomplete') {
        // KYC gate: a required document is missing, rejected or expired.
        Alert.alert('Documents needed', e.message, [
          { text: 'Later', style: 'cancel' },
          { text: 'Upload documents', onPress: () => router.push('/kyc') },
        ]);
        api.kyc().then((k) => setKycGate(k.gating ?? null)).catch(() => {});
      } else {
        Alert.alert(
          'Could not update status',
          e instanceof ApiError ? e.message : 'Please try again.'
        );
      }
    } finally {
      setToggling(false);
    }
  }

  const active = assignments[0];
  const firstName = (rider?.name ?? 'Rider').split(' ')[0];

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{firstName}</Text>
            {me ? (
              <View style={styles.riderTypeBadge}>
                <Ionicons
                  name={me.riderType === 'DEDICATED' ? 'restaurant' : 'globe-outline'}
                  size={12}
                  color={colors.primaryDark}
                />
                <Text style={styles.riderTypeText} numberOfLines={1}>
                  {me.riderType === 'DEDICATED'
                    ? `Dedicated · ${me.dedicatedRestaurant?.name ?? 'Restaurant'}`
                    : 'Fleet rider'}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.riderPill}>
            <Text style={styles.riderPillText}>RIDER</Text>
          </View>
        </View>

        {/* Surge — renders nothing when there's no live surge */}
        <View style={styles.surgeSlot}>
          <SurgeBanner />
        </View>

        {/* Required training — renders nothing when all required modules are certified */}
        <TrainingBanner />

        {/* Online toggle */}
        <View
          style={[
            styles.statusCard,
            online ? styles.statusCardOnline : styles.statusCardOffline,
          ]}
        >
          <View style={styles.statusLeft}>
            <View
              style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]}
            />
            <View style={styles.statusTextWrap}>
              <Text style={styles.statusTitle}>
                {online ? "You're online" : "You're offline"}
              </Text>
              <Text style={styles.statusSubtitle}>
                {online
                  ? 'Receiving delivery requests'
                  : 'Go online to start receiving orders'}
              </Text>
            </View>
          </View>
          <Switch
            value={online}
            onValueChange={toggleOnline}
            disabled={toggling}
            trackColor={{ false: colors.border, true: colors.success }}
            thumbColor={colors.white}
          />
        </View>
        {!online && kycGate && !kycGate.canGoOnline && kycGate.message ? (
          <Pressable style={styles.kycGate} onPress={() => router.push('/kyc')}>
            <Ionicons name="document-text-outline" size={18} color={colors.danger} />
            <Text style={styles.kycGateText}>{kycGate.message}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.danger} />
          </Pressable>
        ) : null}

        {/* Last-synced indicator — makes the 30s heartbeat visibly alive. */}
        <View style={styles.syncRow}>
          <View
            style={[
              styles.syncDot,
              { backgroundColor: online ? colors.success : colors.textMuted },
            ]}
          />
          <Text style={styles.syncText}>
            {lastSyncedAt
              ? `Synced ${relativeTime(lastSyncedAt, now)}`
              : 'Waiting for first sync…'}
          </Text>
        </View>

        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        {/* Break mode — pause pings without going offline */}
        <View style={styles.breakSlot}>
          <BreakModeCard />
        </View>

        {/* Current delivery */}
        <Text style={styles.sectionLabel}>CURRENT DELIVERY</Text>
        {active ? (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/delivery/[id]', params: { id: active.id } })
            }
          >
            <AssignmentCard a={active} />
          </Pressable>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No active delivery</Text>
            <Text style={styles.emptyBody}>
              {online
                ? "You're all caught up. New orders will show up here as they come in."
                : 'Go online above to start receiving delivery requests.'}
            </Text>
          </View>
        )}

        {/* Quick actions */}
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <View style={styles.quickRow}>
          <QuickAction
            icon="map-outline"
            label="Demand Map"
            route="/heatmap"
            tint={colors.primary}
          />
          <QuickAction
            icon="shield-checkmark-outline"
            label="Safety"
            route="/safety"
            tint={colors.danger}
          />
          <QuickAction
            icon="calendar-outline"
            label="Shifts"
            route="/shifts"
            tint={colors.success}
          />
          <QuickAction
            icon="gift-outline"
            label="Incentives"
            route="/incentives"
            tint={colors.warning}
          />
        </View>

        <Pressable onPress={signOut} style={styles.signOut} hitSlop={8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>

      {/* First-launch walkthrough — shown once, then suppressed via secure-store. */}
      <OnboardingTour visible={showTour} onClose={markTourSeen} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  kycGate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  kycGateText: { flex: 1, fontSize: font.size.sm, color: colors.danger, lineHeight: 20 },
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, marginRight: spacing.md },
  greeting: { fontSize: font.size.md, color: colors.textMuted },
  name: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  riderTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.xs + 2,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  riderTypeText: {
    flexShrink: 1,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: colors.primaryDark,
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

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    ...shadow.card,
  },
  statusCardOnline: { backgroundColor: colors.successSoft, borderColor: colors.success },
  statusCardOffline: { backgroundColor: colors.card, borderColor: colors.border },
  statusLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.md },
  dotOnline: { backgroundColor: colors.success },
  dotOffline: { backgroundColor: colors.textMuted },
  statusTextWrap: { flex: 1 },
  statusTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  statusSubtitle: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: 2,
  },

  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs + 2,
  },
  syncText: {
    fontSize: font.size.xs,
    color: colors.textMuted,
    fontWeight: font.weight.medium,
  },

  errorBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },

  surgeSlot: { marginBottom: spacing.md },
  breakSlot: { marginTop: spacing.md },

  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickAction: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: spacing.sm,
  },
  quickActionPressed: { backgroundColor: colors.primarySoft },
  // Perfect circle (48 / 2 = 24 radius) so all four quick-action icons are
  // visually identical regardless of glyph.
  quickIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fixed two-line height so every tile is the same size and the icons line
  // up across the row whether the label is one word or two.
  quickLabel: {
    fontSize: 11,
    lineHeight: 14,
    height: 28,
    fontWeight: font.weight.semibold,
    color: colors.text,
    textAlign: 'center',
  },

  sectionLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  orderCode: {
    flexShrink: 1, // truncates instead of pushing the badge off-screen
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  badge: {
    flexShrink: 0, // never squash the status pill
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
  },

  route: { marginTop: spacing.lg },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  routeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: spacing.md },
  routeText: { flex: 1 },
  routeLabel: {
    fontSize: 10,
    fontWeight: font.weight.bold,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  routeValue: {
    fontSize: font.size.md,
    color: colors.text,
    fontWeight: font.weight.medium,
    marginTop: 1,
  },
  routeSub: {
    fontSize: font.size.sm,
    color: colors.textMuted,
    marginTop: 1,
  },
  routeConnector: {
    width: 1,
    height: 16,
    backgroundColor: colors.border,
    marginLeft: 4,
    marginVertical: 2,
  },

  cardFooter: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaText: { fontSize: font.size.sm, color: colors.textMuted },
  earnings: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.success,
  },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  emptyBody: {
    marginTop: spacing.xs,
    fontSize: font.size.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },

  signOut: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  signOutText: {
    fontSize: font.size.md,
    color: colors.danger,
    fontWeight: font.weight.semibold,
  },
});
