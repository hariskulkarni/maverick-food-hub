/**
 * Raw request path → route template ("/api/orders/cm1x…/status" →
 * "/api/orders/[id]/status"), so metrics group by route, not by URL.
 *
 * Source of truth is Next's own build manifest (`.next/app-path-routes-manifest.json`
 * in `next start`, `.next/server/app-paths-manifest.json` in dev). When a path
 * doesn't match any known route (or the manifest is missing), a heuristic
 * replaces id-looking segments with `[id]`. A hard cardinality cap keeps the
 * metrics table bounded even under a URL-scanning bot.
 */
import fs from 'node:fs';
import path from 'node:path';

export type RouteKind = 'API' | 'PAGE';

interface Matcher {
  template: string;
  segs: string[];
  /** lower = more specific (static segments beat dynamic, dynamic beats catch-all) */
  score: number;
}

let matchers: Matcher[] = [];
let loadedAt = 0;
const RELOAD_MS = 5 * 60_000;

/** Strip route groups "(x)", parallel slots "@x", and the trailing /page|/route. */
export function cleanAppPath(p: string): string {
  const segs = p
    .replace(/\/(page|route)$/, '')
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return '/' + segs.join('/');
}

export function buildMatchers(templates: Iterable<string>): Matcher[] {
  const seen = new Set<string>();
  const out: Matcher[] = [];
  for (const raw of templates) {
    const t = cleanAppPath(raw);
    if (seen.has(t) || t.includes('/_') || t.startsWith('/_')) continue;
    seen.add(t);
    const segs = t.split('/').filter(Boolean);
    let score = 0;
    for (const s of segs) {
      if (s.startsWith('[[...')) score += 1000;
      else if (s.startsWith('[...')) score += 100;
      else if (s.startsWith('[')) score += 10;
    }
    out.push({ template: t, segs, score });
  }
  return out.sort((a, b) => a.score - b.score || b.segs.length - a.segs.length);
}

function matches(m: Matcher, parts: string[]): boolean {
  for (let i = 0; i < m.segs.length; i++) {
    const s = m.segs[i];
    if (s.startsWith('[[...')) return true; // optional catch-all: any remainder
    if (s.startsWith('[...')) return parts.length > i; // needs ≥1 more segment
    if (i >= parts.length) return false;
    if (s.startsWith('[')) continue;
    if (s !== parts[i]) return false;
  }
  return parts.length === m.segs.length;
}

function loadManifest(): void {
  const now = Date.now();
  if (matchers.length > 0 && now - loadedAt < RELOAD_MS) return;
  loadedAt = now;
  const dir = path.join(process.cwd(), '.next');
  const templates: string[] = [];
  try {
    const prod = JSON.parse(fs.readFileSync(path.join(dir, 'app-path-routes-manifest.json'), 'utf8')) as Record<string, string>;
    templates.push(...Object.values(prod));
  } catch {
    /* not built / dev */
  }
  try {
    const dev = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'app-paths-manifest.json'), 'utf8')) as Record<string, string>;
    templates.push(...Object.keys(dev));
  } catch {
    /* ignore */
  }
  if (templates.length) matchers = buildMatchers(templates);
}

/** Test hook: replace the manifest-derived matchers. */
export function setRouteTemplatesForTest(templates: string[] | null): void {
  matchers = templates ? buildMatchers(templates) : [];
  loadedAt = templates ? Date.now() + 10 * RELOAD_MS : 0;
}

const ID_SEG = [
  /^\d+$/, // numeric
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^c[a-z0-9]{20,}$/, // cuid
  /^[A-Za-z0-9_-]{16,}$/, // long opaque token (must also contain a digit — checked below)
  /^[A-Z]{2,5}-[A-Z0-9]{4,}$/, // order codes like ORD-AB12CD
];

export function heuristicTemplate(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean).slice(0, 8);
  return (
    '/' +
    segs
      .map((s) => {
        const isId = ID_SEG.some((re, i) => re.test(s) && (i !== 3 || /\d/.test(s)));
        return isId ? '[id]' : s.length > 40 ? '[slug]' : s;
      })
      .join('/')
  );
}

/** Map a raw pathname to its route template. */
export function routeTemplate(pathname: string): string {
  loadManifest();
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const parts = clean.split('/').filter(Boolean);
  for (const m of matchers) if (matches(m, parts)) return m.template;
  return heuristicTemplate(clean);
}

const ASSET_RE = /\.(?:png|jpe?g|webp|gif|svg|ico|avif|mp4|webm|woff2?|ttf|otf|css|js|map|txt|xml|wasm|webmanifest|json)$/i;

/** Which requests we record, and as what. null = ignore (static assets, Next internals, SSE). */
export function classifyPath(pathname: string): RouteKind | null {
  if (pathname.startsWith('/_next') || pathname.startsWith('/__nextjs')) return null;
  if (pathname.startsWith('/api/events')) return null; // long-lived SSE — latency is meaningless
  if (pathname.startsWith('/api/')) return 'API';
  if (pathname.startsWith('/uploads/') || pathname.startsWith('/downloads/')) return null;
  if (ASSET_RE.test(pathname)) return null;
  return 'PAGE';
}

/** Job runner routes: /api/platform/jobs/<name>/run */
export function jobNameFromPath(pathname: string): string | null {
  const m = /^\/api\/platform\/jobs\/([a-z0-9-]+)\/run\/?$/.exec(pathname);
  return m ? m[1] : null;
}
