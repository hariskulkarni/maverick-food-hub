/**
 * PM2 ecosystem — runs prod AND the demo on the same VPS, sharing the same
 * `.next` build directory. They differ only in env files + ports.
 *
 *   • flavrly-prod runs on :3000, reads apps/web/.env       → flavrly.in
 *   • flavrly-demo runs on :3001, reads apps/web/.env.demo  → demo.flavrly.in
 *
 * Deploy with `./scripts/fix-prod.sh` (prod) and `./scripts/fix-demo.sh` (demo).
 * `pm2 startup` + `pm2 save` on the VPS preserves both processes across boot.
 */
module.exports = {
  apps: [
    {
      name: 'flavrly-prod',
      cwd: '/opt/restaurant-manager/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env_file: '.env',
      max_memory_restart: '1G',
      autorestart: true,
      // Stagger restart so the OS isn't slammed when both processes reload.
      restart_delay: 1000,
      out_file: '/var/log/restaurant-manager/prod-out.log',
      error_file: '/var/log/restaurant-manager/prod-err.log',
    },
    {
      name: 'flavrly-demo',
      cwd: '/opt/restaurant-manager/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3001',
      env_file: '.env.demo',
      max_memory_restart: '512M',
      autorestart: true,
      restart_delay: 2000,
      out_file: '/var/log/restaurant-manager/demo-out.log',
      error_file: '/var/log/restaurant-manager/demo-err.log',
    },
  ],
};
