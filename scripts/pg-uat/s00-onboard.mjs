// S0: onboarding through the app's own APIs (no direct DB writes):
//   platform PG connection (placeholder merchant, required before APPROVE), restaurant requests PG,
//   super approves, super creates the receiving account bound to the gateway merchant,
//   the creator cannot verify it (dual control), a second super admin verifies it.
import { APP, http, note, save, scenario, staffLogin, sqlVal, snap, RESTAURANT_ID, GW_MERCHANT_ID } from './uat-lib.mjs';
import crypto from 'node:crypto';

scenario('s00-onboarding');
const rid = RESTAURANT_ID();
const sup = await staffLogin('super');
const sup2 = await staffLogin('super2');
const admin = await staffLogin('admin');

// Platform connection: a placeholder merchant id that binds nothing (the restaurant has its own credential).
await http('POST', `${APP}/api/platform/youpi/config`, {
  jar: sup,
  body: { baseUrl: 'http://127.0.0.1:6611', merchantId: 'uat-platform-placeholder', webhookSecret: crypto.randomBytes(24).toString('hex') },
});
await http('POST', `${APP}/api/admin/youpi/request`, { jar: admin });
await http('POST', `${APP}/api/platform/youpi/${rid}/decision`, { jar: sup, body: { decision: 'APPROVE' } });

const created = await http('POST', `${APP}/api/platform/youpi/accounts`, {
  jar: sup,
  body: {
    restaurantId: rid,
    gatewayMerchantId: GW_MERCHANT_ID,
    vpa: 'uat-restaurant@upi-fake',
    legalEntityName: 'UAT Synthetic Restaurant Pvt Ltd (FAKE)',
    ifsc: 'UATB0000001',
    accountNumber: '000000009999',
  },
});
const accId = created.json?.id;
const self = await http('POST', `${APP}/api/platform/youpi/accounts/${accId}`, {
  jar: sup,
  body: { action: 'VERIFY', method: 'PENNY_DROP_SYNTHETIC', note: 'creator attempting self-verify (must be refused)' },
});
note(`EXPECT self-verify refused: ${self.status !== 200 ? 'PASS' : 'FAIL'}`);
const ver = await http('POST', `${APP}/api/platform/youpi/accounts/${accId}`, {
  jar: sup2,
  body: { action: 'VERIFY', method: 'PENNY_DROP_SYNTHETIC', note: 'UAT: synthetic verification by a second super admin; no real bank' },
});
note(`EXPECT verify by second super admin 200: ${ver.status === 200 ? 'PASS' : 'FAIL'}`);
snap('db.txt', `select id, "restaurantId", "gatewayMerchantId", vpa, status, "createdById" <> "verifiedById" as dual_control, "disabledForNewAt" from "PgReceivingAccount"`);
snap('db.txt', `select "restaurantId", status from "YoupiFeatureRequest"`);
snap('db.txt', `select "restaurantId", provider, status, length("configEncrypted") as enc_len, summary from "IntegrationCredential" where provider='YOUPI'`);
save('ids.json', { restaurantId: rid, receivingAccountId: accId });
note(`receivingAccountId=${accId} status=${sqlVal(`select status from "PgReceivingAccount" where id='${accId}'`)}`);
