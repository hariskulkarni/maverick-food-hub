/**
 * Registers this device for push notifications and reports the Expo push token
 * to the backend. Called once from the authenticated app shell.
 *
 * NOTE: remote push requires a development / standalone build — it does NOT
 * fire inside Expo Go on Android (Expo dropped that in SDK 53+). The code is
 * correct and activates automatically in the EAS-built APK; inside Expo Go it
 * simply no-ops after the permission check. No harm either way.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { api } from './api';

// Foreground notifications: show a banner + play a sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
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
