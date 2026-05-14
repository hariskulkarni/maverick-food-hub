/**
 * Authenticated app shell — the guard + the bottom tab bar.
 *
 * Anything under (app)/ requires a token; without one we bounce to login.
 * Tabs: Home (dashboard) and Orders (the claimable pool). Earnings and Profile
 * land here as they're built; the active-delivery screen will be a pushed
 * screen on top of these tabs.
 */
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  const { token, loading } = useAuth();

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
    </Tabs>
  );
}
