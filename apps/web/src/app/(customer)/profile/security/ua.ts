/**
 * Tiny, dependency-free User-Agent parser. We don't need pinpoint accuracy —
 * just a friendly label like "Chrome on macOS" / "Safari on iPhone" for the
 * sessions list. Order matters: more specific tokens are checked first (e.g.
 * Edge/Brave/Opera before Chrome, since they all carry "Chrome" in their UA).
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua || !ua.trim()) return 'Unknown device';
  const s = ua;

  // Browser (most specific first).
  let browser = '';
  if (/\bEdg(?:e|A|iOS)?\//.test(s)) browser = 'Edge';
  else if (/\bOPR\/|\bOpera\//.test(s)) browser = 'Opera';
  else if (/\bBrave\//.test(s)) browser = 'Brave';
  else if (/\bSamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/\bFirefox\/|\bFxiOS\//.test(s)) browser = 'Firefox';
  else if (/\bCriOS\//.test(s)) browser = 'Chrome';
  else if (/\bChrome\//.test(s)) browser = 'Chrome';
  else if (/\bSafari\//.test(s) && /\bVersion\//.test(s)) browser = 'Safari';
  else if (/curl\//i.test(s)) browser = 'curl';
  else browser = 'Browser';

  // Platform / OS.
  let os = '';
  if (/iPhone/.test(s)) os = 'iPhone';
  else if (/iPad/.test(s)) os = 'iPad';
  else if (/Android/.test(s)) {
    const m = s.match(/Android\s+([\d.]+)/);
    os = m ? `Android ${m[1]}` : 'Android';
  } else if (/Macintosh|Mac OS X/.test(s)) os = 'macOS';
  else if (/Windows NT 10\.0/.test(s)) os = 'Windows';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Linux/.test(s)) os = 'Linux';
  else os = 'Unknown OS';

  // A native app webview (Capacitor) won't always look like a normal browser.
  if (/Capacitor/i.test(s)) return `Reshee app on ${os}`;

  return `${browser} on ${os}`;
}
