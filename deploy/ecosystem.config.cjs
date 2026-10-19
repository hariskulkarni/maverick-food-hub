/**
 * PM2 ecosystem file for Restaurant Manager.
 *
 *   pm2 start deploy/ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup systemd
 *
 * One long-running process:
 *   - rm-web    : Next.js (next start) on :3000
 *
 * C14.4: the former `rm-worker` process ran `tsx src/server/worker.ts`, a file
 * that does not exist — it crash-looped and aborted every deploy after
 * migrations (deploy.sh did `pm2 reload rm-web rm-worker` under set -e). The
 * four background sweeps in apps/web/src/server/jobs/ are driven by their cron
 * endpoints, so the worker process is removed rather than resurrected.
 *
 * NOTE (flag, not fixed here): ecosystem's old docstring claimed this worker
 * handled escalations and notification retries. With no worker, those are not
 * run in-process — see the HIGH finding "order escalations never fire". The
 * escalation scan needs a cron entry or a real worker; tracked for Phase 3.
 *
 * Adjust `instances` on rm-web if you scale to a multi-core VPS.
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
    }
  ]
};
