# FoodHub Rider — Android shell

This folder wraps the rider PWA (`/rider`) into a native Android app using **Capacitor**.
Same web codebase, no parallel Kotlin/React Native rewrite. Ships to Play Store as a real APK.

## What you get out of the wrapper

- Real Android app on the Play Store, with the FoodHub Rider icon and splash
- Native push notifications (FCM)
- Native camera capture for the delivery proof photo (replaces the browser file input)
- Native geolocation that keeps running when the app is in the background
- Same Next.js codebase you already maintain — `/rider/*` routes inside the WebView

## One-time setup (on your machine)

```bash
# 1. Node 20+, Java 17, Android Studio installed (Arctic Fox or newer)
cd "/Users/hkulkarni/Documents/Claude/Projects/Restaurant Manager/apps/android-rider"
npm install
# 2. Point the wrapper at your deployed FoodHub URL
echo "FOODHUB_URL=https://app.foodhub.example" > .env
# 3. Generate the Android project (one-time)
npx cap add android
# 4. Sync web bundle → native shell
npx cap sync android
# 5. Open in Android Studio
npx cap open android
```

## Daily workflow

```bash
# After any change to the web app at apps/web, re-sync the shell:
npx cap sync android
# Run on a device or emulator:
npx cap run android
```

## Publishing to Play Store

1. In Android Studio: **Build → Generate Signed Bundle** → choose AAB
2. Upload the `.aab` to Google Play Console
3. First release goes to Internal Testing → Closed → Open → Production

## Permissions in `AndroidManifest.xml`

Already declared in `capacitor.config.ts` via plugins:
- `INTERNET` — talk to FoodHub backend
- `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` — live GPS streaming during deliveries
- `CAMERA` — proof-of-delivery photo
- `POST_NOTIFICATIONS` — new-order pings (Android 13+)

## Why Capacitor, not React Native or Flutter?

We already have a fully-featured rider PWA at `/rider`. A native rewrite would
double the codebase and create a second source of truth for delivery logic.
Capacitor gives you ~95% of native UX (icon, splash, push, camera, background
GPS) while keeping a single codebase. Migration to a fully-native Kotlin app
later is straightforward if scale demands it.
