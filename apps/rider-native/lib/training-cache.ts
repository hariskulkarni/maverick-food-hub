/**
 * Offline cache for training content. The last successful response for the
 * library, each opened module and the certificate list is written to the app's
 * document directory, so a rider with no signal can still read lessons they
 * have already loaded. Writes and reads never throw.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { TrainingLang } from './api-growth';

const DIR_NAME = 'training-cache';

function dir(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

function fileFor(key: string): File {
  return new File(dir(), `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

export interface Cached<T> {
  savedAt: number;
  data: T;
}

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const f = fileFor(key);
    if (!f.exists) return null;
    const parsed = JSON.parse(await f.text()) as Cached<T>;
    return parsed && typeof parsed.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  try {
    const d = dir();
    if (!d.exists) d.create({ intermediates: true });
    const f = fileFor(key);
    if (!f.exists) f.create();
    f.write(JSON.stringify({ savedAt: Date.now(), data } satisfies Cached<T>));
  } catch {
    // Cache is best-effort: a full disk must never break the screen.
  }
}

export const cacheKeys = {
  library: (lang: TrainingLang) => `library_${lang}`,
  module: (id: string, lang: TrainingLang) => `module_${id}_${lang}`,
  certificates: () => 'certificates',
  lang: () => 'lang',
};

/** Content language chosen in the training screens (default English). */
export async function getTrainingLang(): Promise<TrainingLang> {
  const c = await readCache<TrainingLang>(cacheKeys.lang());
  return c?.data === 'hi' ? 'hi' : 'en';
}

export function setTrainingLang(lang: TrainingLang): void {
  writeCache(cacheKeys.lang(), lang);
}

/** "Saved 5 min ago" style label for the offline banner. */
export function savedAgo(savedAt: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - savedAt) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
