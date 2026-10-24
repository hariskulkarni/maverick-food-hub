import { execFileSync } from 'node:child_process';
import path from 'node:path';

// PRIVATE Agent D setup (see vitest.db-d.config.ts). Refuses anything but a
// local disposable "ci*" database, then force-resets it to the branch schema.
export default function setup() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('db-d refused: DATABASE_URL is not set');
  const url = new URL(raw);
  const db = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error(`db-d refused: host ${url.hostname}`);
  if (!db.startsWith('ci')) throw new Error(`db-d refused: database ${db}`);
  const webDir = path.resolve(__dirname, '../..');
  execFileSync(
    path.join(webDir, 'node_modules/.bin/prisma'),
    ['db', 'push', '--force-reset', '--skip-generate', '--accept-data-loss'],
    { cwd: webDir, stdio: 'inherit', env: process.env }
  );
}
