// Configures a FRESH local fork gateway for UAT (admin API, throwaway secrets):
//  - receiving UPI account uat-restaurant@upi-fake made the single active VPA of the default merchant
//  - merchant webhook secret := $MERCHANT_SECRET (X-Merchant-Key proof on FORK), merchant webhook URL cleared
//    (no legacy flat-body endpoint)
//  - Standard Webhooks endpoint (envelope, legacyFormat=false) -> webhook tap :3312 -> app :3311
//  Writes the endpoint (incl. its one-time whsec_ secret) to $UAT_DIR/endpoint.json (never evidence).
import fs from 'node:fs';
const U = process.env.UAT_DIR;
const env = Object.fromEntries(fs.readFileSync(`${U}/gw.env`, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const secret = fs.readFileSync(`${U}/gw-merchant.env`, 'utf8').trim().split('=')[1];
const GW = 'http://127.0.0.1:6611';
const H = { authorization: `Bearer ${env.ADMIN_API_TOKEN}`, 'x-merchant-id': '00000000-0000-0000-0000-000000000001', 'content-type': 'application/json' };
const call = async (m, p, b) => {
  const r = await fetch(GW + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => null);
  console.log(`${m} ${p} -> ${r.status}`);
  return j;
};
const acc = await call('POST', '/api/v1/admin/upi-accounts', { upiId: 'uat-restaurant@upi-fake', payeeName: 'UAT Synthetic Restaurant', isActive: true });
await call('POST', `/api/v1/admin/upi-accounts/${acc.account.id}/activate`);
await call('POST', '/api/v1/admin/merchant-settings', { webhookSecret: secret });
await call('POST', '/api/v1/admin/merchant-settings', { webhookUrl: '' });
const ep = await call('POST', '/api/v1/admin/webhooks/endpoints', { url: 'http://localhost:3312/api/payments/youpi/webhook', description: 'Flavrly local UAT (Standard Webhooks envelope)', enabledEvents: ['*'] });
fs.writeFileSync(`${U}/endpoint.json`, JSON.stringify(ep), { mode: 0o600 });
const list = await call('GET', '/api/v1/admin/webhooks/endpoints');
for (const e of list.data) console.log(`endpoint ${e.id} ${e.url} ${e.status} legacy=${e.isLegacy} legacyFormat=${e.legacyFormat}`);
const accts = await call('GET', '/api/v1/admin/upi-accounts');
for (const a of accts.accounts) console.log(`upi ${a.upiId} active=${a.isActive}`);
