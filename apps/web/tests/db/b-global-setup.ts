import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Same guard as Agent C's harness: only a localhost database named ci*. */
export default function setup() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('db tests refused: DATABASE_URL is not set');
  const url = new URL(raw);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error(`db tests refused: host ${url.hostname}`);
  if (!dbName.startsWith('ci')) throw new Error(`db tests refused: database ${dbName}`);
  const webDir = path.resolve(__dirname, '../..');
  execFileSync(path.join(webDir, 'node_modules/.bin/prisma'), ['db', 'push', '--force-reset', '--skip-generate', '--accept-data-loss'], {
    cwd: webDir,
    stdio: 'inherit',
    env: process.env,
  });
}
