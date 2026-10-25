import type { CapacitorConfig } from '@capacitor/cli';
import * as dotenv from 'dotenv';
dotenv.config();

// DEPRECATED shell — the supported rider app is apps/rider-native (Expo).
// There is no `/rider` PWA in apps/web any more (that path 404s), so the shell
// opens `/rider-app`, the real page that installs/onboards riders onto the
// native app. FOODHUB_URL is required (set in .env or inline):
//   FOODHUB_URL=https://flavrly.in npx cap sync android
const FOODHUB_URL = (process.env.FOODHUB_URL ?? '').trim().replace(/\/+$/, '');
if (!FOODHUB_URL) {
  throw new Error(
    'FOODHUB_URL is not set. Pass the deployed web origin, e.g. FOODHUB_URL=https://flavrly.in npx cap sync android ' +
      '(or run deploy/build-apk.sh <url>). There is no localhost default any more.'
  );
}
let parsed: URL;
try {
  parsed = new URL(FOODHUB_URL);
} catch {
  throw new Error(`FOODHUB_URL is not a valid URL: ${FOODHUB_URL}`);
}
if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
  throw new Error(`FOODHUB_URL must be http(s): ${FOODHUB_URL}`);
}
// Cleartext + mixed content are only switched on for an explicit http:// dev
// origin (e.g. http://10.0.2.2:3000). Any https origin — every release build —
// gets the secure defaults.
const isHttp = parsed.protocol === 'http:';

const config: CapacitorConfig = {
  appId: 'app.foodhub.rider',
  appName: 'Flavrly Rider',
  webDir: 'public',
  server: {
    url: `${FOODHUB_URL}/rider-app`,
    cleartext: isHttp,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: isHttp,
    backgroundColor: '#f5f1e8'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#ea5b1f',
      androidSplashResourceName: 'splash',
      showSpinner: false
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    Geolocation: {
      // We need background updates while a delivery is in progress
      // The plugin reads from AndroidManifest.xml permissions
    },
    Camera: {
      // Proof-of-delivery photo
    }
  }
};

export default config;
