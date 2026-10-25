/**
 * Open turn-by-turn navigation in the phone's installed Google Maps app.
 *
 * One helper for every "Navigate" button (incoming offer, pickup, drop):
 *
 *   Android: google.navigation:q=lat,lng&mode=d  (Google Maps driving nav)
 *            → geo:lat,lng?q=lat,lng(label)      (any installed maps app)
 *            → https Google Maps directions URL  (browser)
 *   iOS:     comgooglemaps://?daddr=lat,lng&directionsmode=driving when Google
 *            Maps is installed (needs `comgooglemaps` in
 *            LSApplicationQueriesSchemes — see app.json)
 *            → Apple Maps (https://maps.apple.com/?daddr=…&dirflg=d)
 *            → https Google Maps directions URL
 *
 * Without coordinates the address text is used instead: the app schemes take
 * a free-text query, and the web fallback is a Google Maps search URL.
 *
 * Opening another app never stops delivery tracking: the background location
 * task (lib/background-location.ts) keeps posting while Google Maps is in front.
 */
import { Linking, Platform } from 'react-native';

export interface NavTarget {
  lat?: number | null;
  lng?: number | null;
  /** Human address / place name, used as a label or as the search query when coords are missing. */
  label?: string | null;
}

function hasCoords(t: NavTarget): t is NavTarget & { lat: number; lng: number } {
  return (
    typeof t.lat === 'number' &&
    typeof t.lng === 'number' &&
    Number.isFinite(t.lat) &&
    Number.isFinite(t.lng)
  );
}

/** True when the target has enough information to navigate to. */
export function canNavigate(t: NavTarget | null | undefined): boolean {
  if (!t) return false;
  return hasCoords(t) || !!t.label?.trim();
}

/** Candidate URLs, most preferred first. Exported for tests / debugging. */
export function navigationUrls(t: NavTarget, os: string = Platform.OS): string[] {
  const label = t.label?.trim() ?? '';
  if (hasCoords(t)) {
    const ll = `${t.lat},${t.lng}`;
    const web = `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
    if (os === 'android') {
      const geoQ = label ? `${ll}(${encodeURIComponent(label)})` : ll;
      return [`google.navigation:q=${ll}&mode=d`, `geo:${ll}?q=${geoQ}`, web];
    }
    if (os === 'ios') {
      return [
        `comgooglemaps://?daddr=${ll}&directionsmode=driving`,
        `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
        web,
      ];
    }
    return [web];
  }
  if (!label) return [];
  const q = encodeURIComponent(label);
  const web = `https://www.google.com/maps/search/?api=1&query=${q}`;
  if (os === 'android') return [`google.navigation:q=${q}&mode=d`, `geo:0,0?q=${q}`, web];
  if (os === 'ios') {
    return [
      `comgooglemaps://?daddr=${q}&directionsmode=driving`,
      `https://maps.apple.com/?daddr=${q}&dirflg=d`,
      web,
    ];
  }
  return [web];
}

/**
 * Launch navigation. Resolves true when some app opened, false otherwise.
 * Never throws.
 */
export async function openNavigation(t: NavTarget | null | undefined): Promise<boolean> {
  if (!t) return false;
  const urls = navigationUrls(t);
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLast = i === urls.length - 1;
    try {
      // iOS: only a declared scheme can be probed; skip Google Maps if it is
      // not installed. Android: openURL rejects when no app handles the
      // intent, so we simply try and fall through.
      if (Platform.OS === 'ios' && !isLast && !(await Linking.canOpenURL(url))) continue;
      await Linking.openURL(url);
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
}
