/**
 * Allow-list for URLs that are rendered into a media `src` or a link `href`
 * (image/video previews, "open uploaded file" links).
 *
 * Accepted: root-relative paths (`/uploads/x.webp`), `https:` URLs, `blob:`
 * object URLs (local previews) and `data:image/*`. Everything else —
 * `javascript:`, `vbscript:`, `data:text/html`, protocol-relative `//host`,
 * plain `http:` — is rejected, as is any value carrying quotes, angle
 * brackets, backticks, backslashes or whitespace. Returns the URL unchanged
 * when accepted, otherwise null.
 */
export function safeMediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/[\s"'<>\\`]/.test(raw)) return null; // '&' stays legal: CDN query strings
  if (raw.startsWith('/')) return raw.startsWith('//') ? null : raw;
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(raw)) return raw;
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return null;
  }
  return protocol === 'https:' || protocol === 'blob:' ? raw : null;
}

/**
 * A local preview created with `URL.createObjectURL()`: must be a `blob:` URL
 * and carry no HTML metacharacters at all (object URLs never do).
 */
export function safeBlobUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/["&<>'\s\\`]/.test(raw)) return null;
  return raw.startsWith('blob:') ? raw : null;
}
