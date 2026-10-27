// LOCAL INTEGRATED DEMO ONLY — copied into the scratch Novaryq web worktree by up.sh.
// Wraps the real vite.config.ts and only lets the dev server answer business hosts under the
// demo root domain (VITE_ROOT_DOMAIN=novaryq.test, mapped to 127.0.0.1 inside the demo browser).
import base from './vite.config';

export default async (env: { mode: string; command: 'serve' | 'build' }) => {
  const cfg = typeof base === 'function' ? await (base as (e: typeof env) => any)(env) : base;
  return { ...cfg, server: { ...(cfg.server ?? {}), allowedHosts: ['.novaryq.test', 'localhost', '127.0.0.1'] } };
};
