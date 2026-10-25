import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Throws unless the URL points at a disposable local CI database. Exported for its own test. */
export function assertDisposableDbUrl(raw: string | undefined): URL {
  if (!raw) throw new Error('test:db refused: DATABASE_URL is not set');
  const url = new URL(raw);
  const host = url.hostname;
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`test:db refused: DATABASE_URL host "${host}" is not localhost`);
  }
  if (!dbName.startsWith('ci')) {
    throw new Error(`test:db refused: database "${dbName}" does not start with "ci"`);
  }
  return url;
}

export default function setup() {
  assertDisposableDbUrl(process.env.DATABASE_URL);
  const webDir = path.resolve(__dirname, '../..');
  execFileSync(
    path.join(webDir, 'node_modules/.bin/prisma'),
    ['migrate', 'reset', '--force', '--skip-seed', '--skip-generate'],
    { cwd: webDir, stdio: 'inherit', env: process.env }
  );
}
