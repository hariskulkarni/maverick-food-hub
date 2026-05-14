/**
 * Dashboard — the rider's home screen.
 *
 *   - Online / offline toggle (POST /api/rider/online). While online we ping
 *     /api/rider/heartbeat every 30s so the server's auto-offline sweep keeps
 *     us live.
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
  SafeAreaView,
  Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, type Assignment, type AssignmentStatus } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';

const HEARTBEAT_MS = 30_000;

function rupees(decimalString: string): string {
  const n = Number.parseFloat(decimalString);
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
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

function StatusBadge({ status }: { status: AssignmentStatus }) {
  const meta = STATUS_META[status];
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
        <StatusBadge status={a.status} />
      </View>

      <View style={styles.route}>
        <View style={styles.routeRow}>
          <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
          <View style={styles.routeText}>
            <Text style={styles.routeLabel}>PICKUP</Text>
            <Text style={styles.routeValue} numberOfLines={1}>
              {o.branch?.name ?? 'Restaurant'}
            </Text>
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

export default function DashboardScreen() {
  const { rider, signOut } = useAuth();
  const router = useRouter();
  const [online, setOnline] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [me, list] = await Promise.all([api.me(), api.assignments()]);
      setOnline(me.online);
      setAssignments(list);
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

  // Heartbeat — runs only while online.
  useEffect(() => {
    if (online) {
      api.heartbeat().catch(() => {});
      heartbeatRef.current = setInterval(() => {
        api.heartbeat().catch(() => {});
      }, HEARTBEAT_MS);
    }
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [online]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function toggleOnline(next: boolean) {
    if (toggling) return;
    setToggling(true);
    setOnline(next); // optimistic
    try {
      await api.setOnline(next);
    } catch (e) {
      setOnline(!next); // revert on failure
      Alert.alert(
        'Could not update status',
        e instanceof ApiError ? e.message : 'Please try again.'
      );
    } finally {
      setToggling(false);
    }
  }

  const active = assignments[0];
  const firstName = (rider?.name ?? 'Rider').split(' ')[0];

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
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
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.name}>{firstName}</Text>
          </View>
          <View style={styles.riderPill}>
            <Text style={styles.riderPillText}>RIDER</Text>
          </View>
        </View>

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

        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

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

        <Pressable onPress={signOut} style={styles.signOut} hitSlop={8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: font.size.md, color: colors.textMuted },
  name: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
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

  errorBanner: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
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
