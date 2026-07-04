/**
 * Safe, super-admin-triggerable disk cleanup — the web equivalent of
 * `scripts/safe-cleanup.sh`, runnable from Platform → System health so an
 * operator never has to SSH in.
 *
 * SAFETY MODEL — allowlist, not denylist
 * ──────────────────────────────────────
 * This module only ever touches the FIXED set of cache/log paths declared in
 * `TARGETS` below. There is no wildcard traversal of data directories, no
 * `rm -rf` over anything user-supplied, and every delete path is asserted to
 * live under a known cache root before removal. It can NEVER reach:
 *   • public/uploads, public/banners, public/downloads  (restaurant images)
 *   • the Postgres data directory                        (all app data)
 *   • .env / .env.demo                                   (secrets/config)
 *   • the built app itself (.next/*) — only .next/CACHE is cleared
 *
 * It also runs as the app's own OS user (the pm2 `deploy` user) and therefore
 * needs NO sudo: it clears the Next build cache, the npm cache, and truncates
 * the pm2 log files — exactly the reclaimable space, nothing privileged. The
 * root-only bits (nginx logs, journald, apt) intentionally stay in the shell
 * script; they can't be done safely from an unprivileged web process.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type CleanupKind = 'delete' | 'truncate';

export interface CleanupTarget {
  key: string;
  label: string;
  kind: CleanupKind;
  /** Directory (delete) or the folder whose *.log files are truncated. */
  path: string;
  /** Bytes currently occupied (preview) or reclaimed (after a run). */
  bytes: number;
  /** True once this target has actually been cleared in a run. */
  cleared: boolean;
  /** Non-fatal note, e.g. a permission problem on one file. */
  note?: string;
}

export interface DiskInfo { totalBytes: number; usedBytes: number; freeBytes: number; usedPct: number; }

export interface CleanupReport {
  targets: CleanupTarget[];
  totalBytes: number;
  diskBefore: DiskInfo | null;
  diskAfter: DiskInfo | null;
  ranAt: string;
  dryRun: boolean;
}

const APP_DIR = process.cwd(); // pm2 cwd = /opt/restaurant-manager/apps/web
const PM2_LOG_DIR = process.env.PM2_LOG_DIR || process.env.LOG_DIR || '/var/log/restaurant-manager';

/** The ONLY things this module will ever remove/truncate. */
function targetSpecs(): Array<Omit<CleanupTarget, 'bytes' | 'cleared' | 'note'>> {
  return [
    { key: 'next-cache', label: 'Next.js build cache (.next/cache)', kind: 'delete',   path: path.join(APP_DIR, '.next', 'cache') },
    { key: 'npm-cache',  label: 'npm download cache (~/.npm/_cacache)', kind: 'delete', path: path.join(os.homedir(), '.npm', '_cacache') },
    { key: 'pm2-logs',   label: 'PM2 application logs',                 kind: 'truncate', path: PM2_LOG_DIR },
  ];
}

/**
 * Guard: a `delete` target must sit under a recognised cache root. This makes
 * it structurally impossible to point the deleter at uploads / the DB / the
 * app build even if the constants above are ever edited carelessly.
 */
function assertDeletable(p: string) {
  const resolved = path.resolve(p);
  const okSuffixes = [
    path.join('.next', 'cache'),
    path.join('.npm', '_cacache'),
  ];
  const allowed = okSuffixes.some((s) => resolved.endsWith(s));
  const forbidden = /(?:^|\/)(uploads|banners|downloads|postgresql|\.env)/i.test(resolved) || resolved === '/' || resolved === os.homedir();
  if (!allowed || forbidden) {
    throw new Error(`Refusing to delete non-cache path: ${resolved}`);
  }
}

/** Recursive on-disk size in bytes. Skips symlinks; missing path ⇒ 0. */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Not a dir or doesn't exist — try a single-file stat, else 0.
    try { const st = await fs.lstat(dir); return st.isFile() ? st.size : 0; } catch { return 0; }
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += await dirSize(full);
      else { const st = await fs.lstat(full); total += st.size; }
    } catch { /* skip unreadable entry */ }
  }
  return total;
}

async function diskInfo(): Promise<DiskInfo | null> {
  try {
    // fs.statfs is available on Node 18.15+ (prod runs Node 20).
    const s: any = await (fs as any).statfs('/');
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = total - s.bfree * s.bsize;
    return { totalBytes: total, freeBytes: free, usedBytes: used, usedPct: total ? (used / total) * 100 : 0 };
  } catch {
    return null;
  }
}

/** Sum the sizes of *.log files directly inside `dir`. */
async function logFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.log')).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Compute what's reclaimable without changing anything.
 */
export async function previewCleanup(): Promise<CleanupReport> {
  const targets: CleanupTarget[] = [];
  for (const spec of targetSpecs()) {
    let bytes = 0;
    if (spec.kind === 'delete') {
      bytes = await dirSize(spec.path);
    } else {
      for (const f of await logFiles(spec.path)) {
        try { bytes += (await fs.lstat(f)).size; } catch { /* ignore */ }
      }
    }
    targets.push({ ...spec, bytes, cleared: false });
  }
  return {
    targets,
    totalBytes: targets.reduce((n, t) => n + t.bytes, 0),
    diskBefore: await diskInfo(),
    diskAfter: null,
    ranAt: new Date().toISOString(),
    dryRun: true,
  };
}

/**
 * Actually reclaim the space. Best-effort per target — a failure on one never
 * aborts the others, and is reported via the target's `note`.
 */
export async function runSafeCleanup(): Promise<CleanupReport> {
  const diskBefore = await diskInfo();
  const targets: CleanupTarget[] = [];

  for (const spec of targetSpecs()) {
    const t: CleanupTarget = { ...spec, bytes: 0, cleared: false };
    try {
      if (spec.kind === 'delete') {
        t.bytes = await dirSize(spec.path);
        if (t.bytes > 0) {
          assertDeletable(spec.path);
          await fs.rm(spec.path, { recursive: true, force: true });
        }
        t.cleared = true;
      } else {
        // truncate every *.log in place (reclaims disk; pm2 keeps appending)
        const files = await logFiles(spec.path);
        let freed = 0;
        const failed: string[] = [];
        for (const f of files) {
          try {
            const sz = (await fs.lstat(f)).size;
            await fs.truncate(f, 0);
            freed += sz;
          } catch {
            failed.push(path.basename(f));
          }
        }
        t.bytes = freed;
        t.cleared = true;
        if (failed.length) t.note = `could not truncate: ${failed.join(', ')}`;
      }
    } catch (e) {
      t.note = (e as Error).message;
    }
    targets.push(t);
  }

  return {
    targets,
    totalBytes: targets.reduce((n, t) => n + (t.cleared ? t.bytes : 0), 0),
    diskBefore,
    diskAfter: await diskInfo(),
    ranAt: new Date().toISOString(),
    dryRun: false,
  };
}
