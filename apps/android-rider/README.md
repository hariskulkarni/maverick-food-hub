# FoodHub Rider — Android shell (DEPRECATED)

> **Deprecated.** The supported rider app is the Expo / React Native app in
> [`apps/rider-native`](../rider-native) (build with EAS — see its `BUILD.md`).
> The `/rider` PWA this shell used to wrap no longer exists in `apps/web`
> (the path 404s), so the shell now opens `/rider-app` — the page that installs
> and onboards riders onto the native app. Do not ship new releases from here.
>
> Security defaults: `FOODHUB_URL` is **required** (no `10.0.2.2` default), and
> `cleartext` / `allowMixedContent` are enabled **only** when `FOODHUB_URL` is an
> `http://` dev origin. Every `https://` build gets the secure defaults.

This folder wraps a web page into a native Android app using **Capacitor**.

## What you get out of the wrapper

- Real Android app on the Play Store, with the FoodHub Rider icon and splash
- Native push notifications (FCM)
- Native camera capture for the delivery proof photo (replaces the browser file input)
- Native geolocation that keeps running when the app is in the background
- Same Next.js codebase you already maintain — the `/rider-app` page inside the WebView

## One-time setup (on your machine)

```bash
# 1. Node 20+, Java 17, Android Studio installed (Arctic Fox or newer)
cd "/Users/hkulkarni/Documents/Claude/Projects/Restaurant Manager/apps/android-rider"
npm install
# 2. Point the wrapper at your deployed FoodHub URL
echo "FOODHUB_URL=https://flavrly.in" > .env   # required — config throws without it
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

(Historical) We had a rider PWA at `/rider` when this shell was written; it has since been replaced by `apps/rider-native`. A native rewrite would
double the codebase and create a second source of truth for delivery logic.
Capacitor gives you ~95% of native UX (icon, splash, push, camera, background
GPS) while keeping a single codebase. Migration to a fully-native Kotlin app
later is straightforward if scale demands it.
