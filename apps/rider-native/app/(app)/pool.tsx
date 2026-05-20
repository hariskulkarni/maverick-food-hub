/**
 * Order pool — the claimable, platform-wide queue of READY orders.
 *
 * Each card shows the route, item summary, and (highlighted) what the rider
 * earns. Claiming is a race: the backend returns 409 if another rider grabbed
 * it first, so on 409 we just drop the card. The rider must be online to
 * claim, so we surface an offline banner if they aren't.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, ApiError, type PoolOrder, type RiderMe } from '../../lib/api';
import { colors, spacing, radius, font, shadow } from '../../lib/theme';
import { useOrderAlerts } from '../../lib/use-order-alerts';
import { NewOrderBanner } from '../../components/new-order-banner';

function rupees(n: number): string {
  return Number.isFinite(n) ? `₹${Math.round(n)}` : '₹0';
}

function PoolCard({
  order,
  claiming,
  onClaim,
}: {
  order: PoolOrder;
  claiming: boolean;
  onClaim: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadText}>
          <Text style={styles.restaurant} numberOfLines={1}>
            {order.restaurant}
          </Text>
          <Text style={styles.branch} numberOfLines={1}>
            {order.branch} · {order.code}
          </Text>
          {order.branchAddress ? (
            <View style={styles.pickupRow}>
              <Ionicons name="storefront-outline" size={13} color={colors.textMuted} />
              <Text style={styles.pickupText} numberOfLines={1}>
                Collect from {order.branchAddress}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.payoutPill}>
          <Text style={styles.payoutAmount}>{rupees(order.payout)}</Text>
          <Text style={styles.payoutLabel}>you earn</Text>
        </View>
      </View>

      <Text style={styles.items} numberOfLines={2}>
        {order.itemSummary || 'Order items'}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="navigate-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>
            {order.distanceKm > 0 ? `${order.distanceKm.toFixed(1)} km` : 'Distance n/a'}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="receipt-outline" size={14} color={colors.textMuted} />
          <Text style={styles.metaText}>Order {rupees(order.total)}</Text>
        </View>
      </View>

      {order.delivery ? (
        <View style={styles.dropRow}>
          <Ionicons name="location-outline" size={14} color={colors.textMuted} />
          <Text style={styles.dropText} numberOfLines={1}>
            {order.delivery.line}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={onClaim}
        disabled={claiming}
        style={({ pressed }) => [
          styles.claimButton,
          pressed && styles.claimButtonPressed,
          claiming && styles.claimButtonDisabled,
        ]}
      >
        {claiming ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.claimButtonText}>Claim this order</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function PoolScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<PoolOrder[]>([]);
  const [me, setMe] = useState<RiderMe | null>(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Buzz + banner whenever brand-new orders appear in the pool.
  const { newCount, clear: clearAlerts } = useOrderAlerts(orders);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [meRes, list] = await Promise.all([api.me(), api.pool()]);
      setOnline(meRes.online);
      setMe(meRes);
      setOrders(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the order pool.');
    }
  }, []);

  // Refetch every time the tab gains focus — picks up new pool orders and
  // anything that got claimed elsewhere.
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

  async function claim(order: PoolOrder) {
    if (claimingId) return;
    setClaimingId(order.orderId);
    try {
      await api.claimOrder(order.orderId);
      // Won the race — drop it from the pool and jump to Home where it's now
      // the rider's active delivery.
      setOrders((prev) => prev.filter((o) => o.orderId !== order.orderId));
      Alert.alert('Order claimed', `${order.code} is now your active delivery.`, [
        { text: 'View on Home', onPress: () => router.navigate('/') },
        { text: 'Stay here', style: 'cancel' },
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Lost the race — another rider got it. Quietly remove the stale card.
        setOrders((prev) => prev.filter((o) => o.orderId !== order.orderId));
        Alert.alert('Just missed it', 'Another rider claimed that order first.');
      } else if (e instanceof ApiError && e.status === 400) {
        Alert.alert(
          'You need to be online',
          'Switch yourself online on the Home tab, then claim.'
        );
      } else {
        Alert.alert('Could not claim', e instanceof ApiError ? e.message : 'Please try again.');
      }
    } finally {
      setClaimingId(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // DEDICATED riders only ever see their own restaurant's orders, so frame the
  // whole screen as that restaurant's queue rather than the platform-wide pool.
  const isDedicated = me?.riderType === 'DEDICATED';
  const restaurantName = me?.dedicatedRestaurant?.name ?? 'your restaurant';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Available orders</Text>
        <Text style={styles.subtitle}>
          {orders.length === 0
            ? isDedicated
              ? `No orders from ${restaurantName} right now`
              : 'No orders in the pool right now'
            : isDedicated
              ? `${orders.length} order${orders.length === 1 ? '' : 's'} from ${restaurantName}`
              : `${orders.length} order${orders.length === 1 ? '' : 's'} ready to claim`}
        </Text>
      </View>

      {!online ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="alert-circle" size={16} color={colors.warning} />
          <Text style={styles.offlineText}>
            You're offline — go online on the Home tab to claim orders.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      {newCount > 0 ? (
        <NewOrderBanner count={newCount} onDismiss={clearAlerts} />
      ) : null}

      <FlatList
        data={orders}
        keyExtractor={(o) => o.orderId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        renderItem={({ item }) => (
          <PoolCard
            order={item}
            claiming={claimingId === item.orderId}
            onClaim={() => claim(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Ionicons name="bicycle-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {isDedicated ? 'No orders right now' : 'The pool is empty'}
            </Text>
            <Text style={styles.emptyBody}>
              {isDedicated
                ? `There are no orders from ${restaurantName} right now. New orders appear here the moment they're marked ready. Pull down to refresh.`
                : 'New orders appear here the moment a restaurant marks them ready. Pull down to refresh.'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: font.size.sm,
    color: colors.textMuted,
  },

  offlineBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#fdf4e3',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  offlineText: {
    flex: 1,
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 18,
  },
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: font.size.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardHeadText: { flex: 1, marginRight: spacing.md },
  restaurant: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  branch: {
    marginTop: 1,
    fontSize: font.size.sm,
    color: colors.textMuted,
  },
  pickupRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pickupText: {
    flex: 1,
    fontSize: font.size.xs,
    color: colors.textMuted,
  },
  payoutPill: {
    alignItems: 'center',
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  payoutAmount: {
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    color: colors.success,
  },
  payoutLabel: {
    fontSize: 10,
    color: colors.success,
    fontWeight: font.weight.semibold,
    letterSpacing: 0.5,
  },

  items: {
    marginTop: spacing.md,
    fontSize: font.size.sm,
    color: colors.text,
    lineHeight: 20,
  },

  metaRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.lg,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: font.size.sm, color: colors.textMuted },

  dropRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dropText: {
    flex: 1,
    fontSize: font.size.sm,
    color: colors.textMuted,
  },

  claimButton: {
    marginTop: spacing.lg,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimButtonPressed: { backgroundColor: colors.primaryDark },
  claimButtonDisabled: { opacity: 0.7 },
  claimButtonText: {
    color: colors.white,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },

  emptyCard: {
    marginTop: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  emptyTitle: {
    marginTop: spacing.md,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
    color: colors.text,
  },
  emptyBody: {
    marginTop: spacing.xs,
    fontSize: font.size.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
