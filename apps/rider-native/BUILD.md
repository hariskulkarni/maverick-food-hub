# Oak & Sizzler Rider — building & distributing the APK

The rider app is an Expo (React Native) app. During development you run it
through **Expo Go** (`npx expo start` + scan the QR). To get a real,
installable, standalone **APK** — one a rider downloads and uses without Expo
Go — you build it with **EAS Build** (Expo's cloud build service).

---

## One-time setup

### 1. Install the EAS CLI and sign in

```bash
npm install -g eas-cli
eas login        # use your Expo account (free tier is fine)
```

### 2. Link the project

From `apps/rider-native/`:

```bash
eas init
```

This creates an EAS project and writes `extra.eas.projectId` into `app.json`.
That projectId is also what `getExpoPushTokenAsync()` uses, so push
notifications start working in the built app once this is done.

### 3. Google Maps API key (required for the map screen)

`react-native-maps` works keyless inside Expo Go, but a standalone Android build
needs your own key:

1. Google Cloud Console → create a project (or reuse one) → enable
   **Maps SDK for Android**.
2. Create an API key, restrict it to Android apps with package name
   `com.oakandsizzler.rider`.
3. In `app.json`, replace `REPLACE_WITH_GOOGLE_MAPS_ANDROID_KEY` under
   `android.config.googleMaps.apiKey` with the real key.

(If you skip this, everything else works — the delivery screen just shows the
"map unavailable" placeholder instead of the map.)

---

## Build the installable APK

```bash
cd "apps/rider-native"
eas build --platform android --profile preview
```

- The `preview` profile (see `eas.json`) produces a **`.apk`** with
  `distribution: internal` — exactly what you want for sideloading and testing.
- The build runs on Expo's servers (~10–20 min). EAS handles the Android
  signing keystore for you and stores it — no manual `keytool`.
- When it finishes, the CLI prints a download URL (also visible at
  `expo.dev` → your project → Builds). Download the `.apk`.

### Install it on a phone

- Transfer the `.apk` via Google Drive / USB / `adb install app.apk`
- On the phone: **Settings → Security → Install unknown apps** → allow your
  file manager
- Tap the APK to install. First launch asks for **location** (live tracking)
  and **camera** (proof-of-delivery) permissions, and registers for push.

---

## Production build (Play Store)

When you're ready to publish:

```bash
eas build --platform android --profile production
```

The `production` profile builds an **`.aab`** (Android App Bundle — the format
Google Play requires) and auto-increments the version code. Then:

```bash
eas submit --platform android --profile production
```

…or upload the `.aab` to the Play Console manually. First release goes through
Internal Testing → Closed → Open → Production.

---

## Pointing at the production domain

`lib/api.ts` currently has `API_BASE = 'http://148.230.66.124'` (the raw VPS
IP). Once `oakandsizzler.com` has DNS + SSL live, change that one line to
`https://oakandsizzler.com` and rebuild. Everything else — auth, maps, GPS,
camera, push — already routes through that constant.

---

## What works where

| Feature | Expo Go (dev) | EAS APK (standalone) |
|---|---|---|
| Login, dashboard, pool, delivery flow | ✅ | ✅ |
| Native map + GPS streaming | ✅ (keyless) | ✅ (needs Maps API key) |
| Camera proof-of-delivery | ✅ | ✅ |
| **Remote push notifications** | ❌ (Expo Go dropped this in SDK 53+) | ✅ (after `eas init` sets projectId) |

So the only thing you genuinely *can't* test in Expo Go is remote push — and
that lights up automatically in the EAS-built APK.
