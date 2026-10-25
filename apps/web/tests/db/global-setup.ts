import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Reset the throwaway CI database to the current schema. Local ci_* DBs only. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://ci@localhost:55432/ci_rider_r3?schema=public';
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port !== '55432' || !db.startsWith('ci_')) {
    throw new Error(`Refusing to reset ${u.hostname}:${u.port}/${db} — tests/db only runs against local ci_* databases on :55432`);
  }
  execFileSync(
    path.resolve(__dirname, '../../node_modules/.bin/prisma'),
    ['db', 'push', '--force-reset', '--skip-generate', '--accept-data-loss'],
    { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' }
  );
}
