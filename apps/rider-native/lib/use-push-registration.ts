/**
 * Registers this device for push notifications and reports the Expo push token
 * to the backend. Called once from the authenticated app shell.
 *
 * IMPORTANT: remote push was removed from Expo Go in SDK 53+. Even *importing*
 * `expo-notifications` at module scope inside Expo Go throws a console error,
 * so we:
 *   - detect Expo Go via expo-constants and no-op there entirely
 *   - load expo-notifications with a *dynamic* import, so the native module is
 *     never even evaluated while running in Expo Go
 *
 * In a development build or the EAS-built standalone APK this runs normally:
 * ask permission → get the Expo push token → report it to
 * /api/rider/push-token. No code change needed between dev and prod.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { api } from './api';

// `storeClient` === running inside the Expo Go app.
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    // Expo Go can't do remote push — silently skip; this lights up in a real build.
    if (!enabled || IS_EXPO_GO) return;

    let cancelled = false;

    (async () => {
      try {
        // Dynamic import: Expo Go never evaluates the native module because we
        // returned above before reaching this line.
        const Notifications = await import('expo-notifications');

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
          }),
        });

        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== 'granted') {
          const requested = await Notifications.requestPermissionsAsync();
          status = requested.status;
        }
        if (status !== 'granted' || cancelled) return;

        // Android needs a channel for heads-up display of incoming pings.
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('orders', {
            name: 'New orders',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }

        const tokenResponse = await Notifications.getExpoPushTokenAsync();
        if (cancelled) return;
        await api.registerPushToken(tokenResponse.data).catch(() => {});
      } catch {
        // Push is a nice-to-have — never block the app on it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
