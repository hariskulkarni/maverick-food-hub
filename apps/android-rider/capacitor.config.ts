import type { CapacitorConfig } from '@capacitor/cli';
import * as dotenv from 'dotenv';
dotenv.config();

// The WebView loads the deployed Rider PWA. Set FOODHUB_URL in .env, or pass inline:
//   FOODHUB_URL=http://10.0.2.2:3000 npx cap sync android
const FOODHUB_URL = process.env.FOODHUB_URL ?? 'http://10.0.2.2:3000';

const config: CapacitorConfig = {
  appId: 'app.foodhub.rider',
  appName: 'FoodHub Rider',
  webDir: 'public',
  server: {
    url: `${FOODHUB_URL}/rider`,
    cleartext: true,                  // dev — allow http://192.168.x or http://10.0.2.2
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,          // dev only — set to false again for prod release
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
