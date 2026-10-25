/**
 * Video lesson URL → how to show it. YouTube / Vimeo become privacy-friendly
 * embeds (both allowed by the CSP frame-src); direct .mp4/.webm play in a
 * <video>; anything else is shown as an external link.
 */
export type VideoSource =
  | { kind: 'embed'; src: string; provider: 'youtube' | 'vimeo' }
  | { kind: 'file'; src: string }
  | { kind: 'link'; src: string }
  | { kind: 'invalid' };

export function videoSource(raw: string | null | undefined): VideoSource {
  const url = (raw ?? '').trim();
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'invalid' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'invalid' };
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const yt = (id: string | null | undefined) =>
    id && /^[\w-]{6,20}$/.test(id) ? ({ kind: 'embed', provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` } as const) : null;
  if (host === 'youtu.be') return yt(u.pathname.slice(1)) ?? { kind: 'link', src: url };
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const m = /^\/(?:embed|shorts|live)\/([\w-]+)/.exec(u.pathname);
    return yt(m?.[1] ?? u.searchParams.get('v')) ?? { kind: 'link', src: url };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /\/(\d{5,12})(?:$|\/|\?)/.exec(u.pathname + '/');
    if (m) return { kind: 'embed', provider: 'vimeo', src: `https://player.vimeo.com/video/${m[1]}` };
  }
  if (/\.(mp4|webm|m4v)$/i.test(u.pathname)) return { kind: 'file', src: url };
  return { kind: 'link', src: url };
}
