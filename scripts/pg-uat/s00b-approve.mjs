// S0b: continuation after DEFECT-1 (platform PG config 500 on a fresh DB: FK on the '__platform__'
// sentinel restaurant, which only setPlatformSecurity() lazily creates). Workaround via the app's own
// API: PATCH /api/platform/security with the default lockoutMinutes (no behaviour change) creates
// the sentinel; then the platform config saves and the restaurant request can be approved.
import { APP, http, note, scenario, staffLogin, snap, RESTAURANT_ID } from './uat-lib.mjs';
import crypto from 'node:crypto';
scenario('s00-onboarding');
const rid = RESTAURANT_ID();
const sup = await staffLogin('super');
await http('GET', `${APP}/api/platform/security`, { jar: sup });
await http('PATCH', `${APP}/api/platform/security`, { jar: sup, body: { lockoutMinutes: 15 } });
const cfg = await http('POST', `${APP}/api/platform/youpi/config`, {
  jar: sup,
  body: { baseUrl: 'http://127.0.0.1:6611', merchantId: 'uat-platform-placeholder', webhookSecret: crypto.randomBytes(24).toString('hex') },
});
note(`platform config after workaround: ${cfg.status}`);
await http('POST', `${APP}/api/platform/youpi/${rid}/decision`, { jar: sup, body: { decision: 'APPROVE' } });
snap('db.txt', `select "restaurantId", status, "requestedById" is not null as requested, "decidedById" is not null as decided from "YoupiFeatureRequest"`);
snap('db.txt', `select "restaurantId", provider, status, summary from "IntegrationCredential" where provider='YOUPI'`);
