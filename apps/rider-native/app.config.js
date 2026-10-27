// Dynamic Expo config: app.json plus values that must not live in git.
//
// GOOGLE_MAPS_ANDROID_KEY — the Maps SDK for Android key (restricted to
// com.flavrly.rider + the EAS signing SHA-1). Set it as an EAS environment
// variable (expo.dev → project → Environment variables, or
// `eas env:create --name GOOGLE_MAPS_ANDROID_KEY ...`) for the preview and
// production environments. Without it the in-app map shows "map unavailable";
// navigation via the Google Maps app still works.
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_ANDROID_KEY || '';
  if (!key && process.env.EAS_BUILD) {
    console.warn('[app.config] GOOGLE_MAPS_ANDROID_KEY is not set — the in-app map will be unavailable in this build.');
  }
  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android && config.android.config),
        googleMaps: { apiKey: key },
      },
    },
  };
};
