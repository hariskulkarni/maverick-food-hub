/**
 * Authenticated app layout — the guard. Anything under (app)/ requires a token;
 * without one we bounce to the login screen. This is also where the bottom-tab
 * navigation will live once the dashboard / pool / earnings screens land.
 */
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  const { token, loading } = useAuth();

  // Root layout already gates on `loading`, but guard again so a deep link
  // can't slip past before the token restore finishes.
  if (loading) return null;
  if (!token) return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
