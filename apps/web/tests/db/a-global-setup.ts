import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Agent A private setup: refuse anything but a local disposable ci* DB, then push the schema. */
export default function setup() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('db-a refused: DATABASE_URL is not set');
  const url = new URL(raw);
  const db = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || !db.startsWith('ci')) {
    throw new Error(`db-a refused: ${url.hostname}/${db} is not a local ci* database`);
  }
  const webDir = path.resolve(__dirname, '../..');
  execFileSync(
    path.join(webDir, 'node_modules/.bin/prisma'),
    ['db', 'push', '--force-reset', '--skip-generate', '--accept-data-loss'],
    { cwd: webDir, stdio: 'inherit', env: process.env },
  );
}
