#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# FoodHub Rider — one-shot signed APK build
#
# Usage:
#   ./deploy/build-apk.sh https://yourdomain.in
#
# What it does:
#   1. Validates that the URL is reachable (no point building an APK against
#      a domain that doesn't resolve — that's how you ship ERR_NAME_NOT_RESOLVED)
#   2. Writes FOODHUB_URL into apps/android-rider/.env
#   3. Runs `npx cap sync android` so the WebView points at the right host
#   4. Runs ./gradlew assembleRelease
#   5. Copies the signed APK into ./out/foodhub-rider-<date>-<git-sha>.apk
#
# Prereqs (on the dev machine, not the VPS):
#   - Node 20+
#   - Java 17 (`brew install temurin@17` on macOS, then `export JAVA_HOME=...`)
#   - Android Studio + Android SDK
#   - Signing keystore + apps/android-rider/android/keystore.properties wired
#     up (see §11.3 of docs/PRODUCTION-DEPLOY.md)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <FOODHUB_URL>"
  echo "Example: $0 https://yourdomain.in"
  exit 1
fi

FOODHUB_URL="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RIDER_DIR="$REPO_ROOT/apps/android-rider"
ANDROID_DIR="$RIDER_DIR/android"
OUT_DIR="$REPO_ROOT/out"

# ── sanity checks ─────────────────────────────────────────────────────────
echo "→ Checking $FOODHUB_URL is reachable"
if ! curl -fsS --max-time 5 "$FOODHUB_URL/api/system/health" | grep -q '"ok":true'; then
  echo "✗ $FOODHUB_URL/api/system/health did not return ok=true"
  echo "  Make sure the web app is deployed and healthy before building the APK."
  echo "  (You can override this check by passing --force as the second arg.)"
  if [[ "${2:-}" != "--force" ]]; then
    exit 1
  fi
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  echo "JAVA_HOME is not set. Run: export JAVA_HOME=\$(/usr/libexec/java_home -v 17)" >&2
  exit 1
fi

if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "✗ $ANDROID_DIR does not exist."
  echo "  Run the one-time wrapper setup first:"
  echo "    cd $RIDER_DIR && npm install && npx cap add android"
  exit 1
fi

if [[ ! -f "$ANDROID_DIR/keystore.properties" ]]; then
  echo "✗ $ANDROID_DIR/keystore.properties is missing."
  echo "  Generate a signing key per §11.3 of docs/PRODUCTION-DEPLOY.md"
  exit 1
fi

# ── prep ──────────────────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
GIT_SHA=$(cd "$REPO_ROOT" && git rev-parse --short HEAD)
DATE=$(date -u +%Y-%m-%d)
OUT_PATH="$OUT_DIR/foodhub-rider-$DATE-$GIT_SHA.apk"

echo "→ Writing FOODHUB_URL=$FOODHUB_URL"
echo "FOODHUB_URL=$FOODHUB_URL" > "$RIDER_DIR/.env"

cd "$RIDER_DIR"
echo "→ npm install (idempotent)"
npm install --silent

echo "→ npx cap sync android"
FOODHUB_URL="$FOODHUB_URL" npx cap sync android

# ── build ─────────────────────────────────────────────────────────────────
cd "$ANDROID_DIR"
echo "→ ./gradlew clean assembleRelease"
./gradlew --no-daemon clean assembleRelease

SOURCE_APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$SOURCE_APK" ]]; then
  echo "✗ Expected output APK not found at $SOURCE_APK" >&2
  exit 1
fi

cp "$SOURCE_APK" "$OUT_PATH"
echo ""
echo "✓ Built signed APK:"
echo "    $OUT_PATH"
echo ""
echo "Size: $(du -h "$OUT_PATH" | cut -f1)"
echo "SHA256: $(shasum -a 256 "$OUT_PATH" | cut -d' ' -f1)"
echo ""
echo "Next steps:"
echo "  • Transfer to phone via Drive/USB/adb install"
echo "  • Or sideload:  adb install -r '$OUT_PATH'"
echo "  • For Play Store: rebuild with ./gradlew bundleRelease → .aab"
