/**
 * Novaryq alerts: e-mail the restaurant's admins (+ owner) and platform super
 * admins (recipientsForRestaurant), debounced per (entity, kind). Best-effort:
 * an alert failure never fails the caller.
 */
import { checkAndStamp, recipientsForRestaurant } from '../alerts';
import { notify } from '../notifications';
import { log } from '../log';

export type NovaryqAlertKind = 'push_failed' | 'push_dead' | 'cancel_failed' | 'pos_voided' | 'webhook_dead';

export async function sendNovaryqAlert(a: {
  restaurantId: string;
  kind: NovaryqAlertKind;
  entityId: string;
  subject: string;
  text: string;
}): Promise<void> {
  try {
    const gate = await checkAndStamp('Novaryq', a.entityId, `novaryq.${a.kind}`, { subject: a.subject });
    if (gate.skipped) return;
    const recipients = await recipientsForRestaurant(a.restaurantId);
    for (const to of recipients) {
      await notify
        .email({ to, subject: a.subject, body: a.text, template: `alert.novaryq.${a.kind}`, restaurantId: a.restaurantId })
        .catch((e) => log.error({ err: (e as Error).message, to }, 'novaryq.alert.email_failed'));
    }
  } catch (e) {
    log.error({ err: (e as Error).message, kind: a.kind }, 'novaryq.alert.failed');
  }
}
