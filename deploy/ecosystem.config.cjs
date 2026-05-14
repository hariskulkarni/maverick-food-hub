/**
 * PM2 ecosystem file for Restaurant Manager.
 *
 *   pm2 start deploy/ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup systemd
 *
 * Two long-running processes:
 *   - rm-web    : Next.js (next start) on :3000
 *   - rm-worker : background worker (cron jobs, escalations, notification retries)
 *
 * Adjust `instances` on rm-web if you scale to a multi-core VPS — leave the
 * worker at 1 to avoid duplicated cron firings.
 */
module.exports = {
  apps: [
    {
      name: 'rm-web',
      cwd: '/opt/restaurant-manager/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3000',
      instances: 1,                 // bump to 'max' on 4+ vCPU once you confirm SSE works under cluster
      exec_mode: 'fork',            // 'cluster' if instances > 1
      max_memory_restart: '700M',
      kill_timeout: 8000,
      wait_ready: true,
      listen_timeout: 15000,
      env: { NODE_ENV: 'production' },
      env_production: { NODE_ENV: 'production' },
      out_file: '/var/log/restaurant-manager/web.out.log',
      error_file: '/var/log/restaurant-manager/web.err.log',
      merge_logs: true,
      time: true
    },
    {
      name: 'rm-worker',
      cwd: '/opt/restaurant-manager/apps/web',
      // Worker entry — uses tsx to run the compiled or source worker script.
      // Replace with `node dist/worker.js` once you ship a built worker.
      script: 'node_modules/.bin/tsx',
      args: 'src/server/worker.ts',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 8000,
      env: { NODE_ENV: 'production', WORKER: 'true' },
      env_production: { NODE_ENV: 'production', WORKER: 'true' },
      out_file: '/var/log/restaurant-manager/worker.out.log',
      error_file: '/var/log/restaurant-manager/worker.err.log',
      merge_logs: true,
      time: true,
      autorestart: true,
      restart_delay: 5000
    }
  ]
};
