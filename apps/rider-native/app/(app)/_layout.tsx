/**
 * Authenticated app shell — the guard + the bottom tab bar.
 *
 * Anything under (app)/ requires a token; without one we bounce to login.
 * Four tabs: Home (dashboard), Orders (the claimable pool), Earnings, Profile.
 * The active-delivery screen is a pushed full-screen route on top of these.
 *
 * This is also where push-notification registration kicks in — it runs as soon
 * as the rider is authenticated.
 */
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { usePushRegistration } from '../../lib/use-push-registration';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  const { token, loading } = useAuth();

  // Register for push notifications once authenticated. Called unconditionally
  // (rules of hooks) — the `enabled` flag gates the actual work.
  usePushRegistration(!!token && !loading);

  // Root layout already gates on `loading`, but guard again so a deep link
  // can't slip past before the token restore finishes.
  if (loading) return null;
  if (!token) return <Redirect href="/login" />;

  return (
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
  );
}
