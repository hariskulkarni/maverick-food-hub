/**
 * Authenticated app shell — the guard + the bottom tab bar.
 *
 * Anything under (app)/ requires a token; without one we bounce to login.
 * Five tabs: Home (dashboard), Orders (the pool), Activity (recent feed),
 * Earnings, Profile. The active-delivery screen is a pushed full-screen route
 * on top of these.
 *
 * This is also where push-notification registration kicks in — it runs as soon
 * as the rider is authenticated.
 *
 * The IncomingOrderPopup is mounted here (not in any single tab) so it floats
 * over every screen the moment a fresh pool order lands. We poll the rider's
 * `online` flag via api.me() every 15s; only when ONLINE does usePoolWatcher
 * actually hit /api/rider/pool.
 */
import { useEffect, useState } from 'react';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { usePushRegistration } from '../../lib/use-push-registration';
import { usePoolWatcher } from '../../lib/use-pool-watcher';
import { useBatchInvitations } from '../../lib/use-batch-invitations';
import { IncomingOrderPopup } from '../../components/incoming-order-popup';
import { BatchInvitationModal } from '../../components/batch-invitation-modal';
import { api } from '../../lib/api';
import { colors } from '../../lib/theme';

const ONLINE_POLL_MS = 15_000;

export default function AppLayout() {
  const { token, loading } = useAuth();
  const router = useRouter();

  // Register for push notifications once authenticated. Called unconditionally
  // (rules of hooks) — the `enabled` flag gates the actual work.
  usePushRegistration(!!token && !loading);

  // Lightweight "am I online?" poll — keeps the pool watcher gated correctly
  // even if the rider toggles online from a different screen. Cheap call.
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (!token || loading) {
      setOnline(false);
      return;
    }
    let cancelled = false;
    const ping = () => {
      api
        .me()
        .then((me) => {
          if (!cancelled) setOnline(me.online);
        })
        .catch(() => {
          /* swallow — keep last-known state */
        });
    };
    ping();
    const id = setInterval(ping, ONLINE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, loading]);

  // Watch the pool for brand-new orders. Returns the freshest one + an ack.
  const { newOrder, ack } = usePoolWatcher(!!token && !loading && online);

  // Watch for batch invitations (mid-delivery offers). Poll runs every 3s.
  const batch = useBatchInvitations(!!token && !loading && online);

  // Root layout already gates on `loading`, but guard again so a deep link
  // can't slip past before the token restore finishes.
  if (loading) return null;
  if (!token) return <Redirect href="/login" />;

  const popupOrder = newOrder
    ? {
        id: newOrder.orderId,
        code: newOrder.code,
        branchName: newOrder.branch || newOrder.restaurant || 'Restaurant',
        customerArea: newOrder.delivery?.line ?? 'Customer area',
        earnings: newOrder.payout,
        pickupKm: newOrder.distanceKm,
      }
    : null;

  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="pool"
        options={{
          title: 'Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bicycle" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" color={color} size={size} />
          ),
        }}
      />
    </Tabs>

    {/* Full-screen "new order" overlay — floats over every tab. */}
    <IncomingOrderPopup
      visible={!!popupOrder}
      order={popupOrder}
      onView={() => {
        ack();
        // Jump to the pool tab so the rider can claim it.
        router.push('/pool');
      }}
      onDismiss={ack}
    />

    {/* Batch-invitation modal — shown when the dispatcher offers this rider a
        second order to batch onto their current trip. Sits above the tab bar
        and above the IncomingOrderPopup z-order (RN renders later siblings on top). */}
    <BatchInvitationModal
      visible={!!batch.current}
      invitation={batch.current}
      onAccept={(id) => {
        batch.accept(id);
      }}
      onDecline={(id) => {
        batch.decline(id);
      }}
    />
    </>
  );
}
