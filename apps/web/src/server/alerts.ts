/**
 * Alert dispatcher for "admin inbox" events.
 *
 * Two flavours, both backed by the same debounce mechanism:
 *
 *   1. Menu / category / combo availability toggles
 *      → sendMenuToggleAlert({ entity, oldStatus, newStatus, actor, restaurant, … })
 *      Recipients: every restaurant ADMIN for the restaurant + every super-admin.
 *
 *   2. Integration setting changes
 *      → sendIntegrationAlert({ integration, actor, restaurant, changedFields, testStatus })
 *      Recipients: same set. Sensitive values are masked via `maskSecret` so the
 *      email never carries the full credential.
 *
 * Both helpers:
 *   - render an HTML body via the pure formatters below
 *   - write a NotificationLog row through `notify.email` (already journals)
 *   - upsert an `AlertDebounce` row keyed by (entityType, entityId, kind)
 *     so a flurry of toggles within `DEBOUNCE_WINDOW_MIN` won't re-fire
 *
 * The pure formatters + maskSecret are exported separately so unit tests can
 * assert the exact email body without spinning up the DB or the SMTP layer.
 */
import { prisma } from './db';
import { notify } from './notifications';
import { log } from './log';

// ── Constants ─────────────────────────────────────────────────────────────

/** Window in minutes during which a repeated (entity, kind) alert is suppressed. */
export const DEBOUNCE_WINDOW_MIN = 5;

// ── Sensitive-value masking ───────────────────────────────────────────────

/**
 * Reveal at most the last `keep` characters of a secret-ish value, replacing
 * the rest with `•`. Empty or short values produce a fully-masked output so a
 * 4-char API key doesn't show in full. `null` / `undefined` → `'(not set)'`
 * so the email reads naturally instead of "undefined".
 *
 *   maskSecret('sk_live_abcdefghij1234')        →  '•••••••••••••1234'
 *   maskSecret('whsec_q')                       →  '••••••'
 *   maskSecret('webhook@example.com', 4)        →  '•••••••••••••.com' (kept tail)
 *   maskSecret(null)                            →  '(not set)'
 *   maskSecret('')                              →  '(empty)'
 */
export function maskSecret(value: string | null | undefined, keep = 4): string {
  if (value == null) return '(not set)';
  const s = String(value);
  if (s.length === 0) return '(empty)';
  // Short values get fully masked — revealing the last `keep` chars of an
  // 8-char secret leaves 4 visible, which is more leakage than we want.
  // Rule: keep the tail only when the masked prefix would be at least 4 chars long.
  if (s.length - keep < 4) return '•'.repeat(Math.max(6, s.length));
  return '•'.repeat(Math.max(6, s.length - keep)) + s.slice(-keep);
}

/**
 * Mask a typical "fielded" credential bag for inclusion in an email. The
 * caller passes either a flat object or a string. Recognised key patterns
 * (`/secret/i`, `/key/i`, `/token/i`, `/password/i`, `/credential/i`) get
 * masked. Other keys are stringified as-is so admins can spot config drift
 * without seeing the secret half.
 */
export function maskCredentials(input: any): Record<string, string> {
  if (!input) return {};
  if (typeof input !== 'object') return { value: maskSecret(String(input)) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const lower = k.toLowerCase();
    const sensitive = /(secret|key|token|password|credential|api[_-]?key|auth)/i.test(lower);
    out[k] = sensitive ? maskSecret(v == null ? null : String(v)) : (v == null ? '(not set)' : String(v));
  }
  return out;
}

// ── Pure formatters ───────────────────────────────────────────────────────

export interface MenuToggleAlertCtx {
  entityType: 'MenuItem' | 'Category' | 'Combo' | 'Bulk';
  entityId: string;          // for `Bulk`, callers pass a synthetic id e.g. `bulk:<branch>:<ts>`
  entityName: string;
  restaurantName: string;
  branchName: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string;
  oldStatus: string;         // "Enabled" / "Disabled" / "10 items enabled"
  newStatus: string;
  reason?: string | null;
  timestamp: Date;
  // Optional deep link to the admin row that changed.
  detailUrl?: string | null;
}

export function formatAvailabilityEmail(ctx: MenuToggleAlertCtx): { subject: string; html: string; text: string } {
  const verb = ctx.entityType === 'Bulk'
    ? 'Bulk availability change'
    : `${ctx.entityType} ${ctx.newStatus.toLowerCase().includes('enabled') ? 'enabled' : 'disabled'}`;

  // Subject is plain text (not HTML) so no escaping needed — but we strip any
  // newline/CR injection to keep header-style fields well-formed.
  const subject = `[${ctx.restaurantName}] ${verb}: ${ctx.entityName}`.replace(/[\r\n]+/g, ' ');

  // Plain-text fallback first — easier to scan in alert digests.
  const text = [
    `${verb}`,
    ``,
    `Restaurant: ${ctx.restaurantName}`,
    ctx.branchName ? `Branch: ${ctx.branchName}` : null,
    `Item / category: ${ctx.entityName}`,
    `Old status: ${ctx.oldStatus}`,
    `New status: ${ctx.newStatus}`,
    `Changed by: ${ctx.actorName ?? ctx.actorEmail ?? 'unknown'} (${ctx.actorRole})`,
    ctx.reason ? `Reason: ${ctx.reason}` : null,
    `Timestamp: ${ctx.timestamp.toISOString()}`,
    ctx.detailUrl ? `Open in admin: ${ctx.detailUrl}` : null
  ].filter(Boolean).join('\n');

  const html = `
<div style="font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;background:#fff;">
  <div style="padding:24px;background:linear-gradient(135deg,#fff4ec 0%,#fff 100%);border-bottom:1px solid #f1e3d4;">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#b34a00;font-weight:600;">Menu availability change</div>
    <h2 style="margin:6px 0 0;font-size:20px;color:#1a1a1a;">${escapeHtml(verb)}</h2>
    <p style="margin:6px 0 0;color:#555;font-size:13px;">at <strong>${escapeHtml(ctx.restaurantName)}</strong>${ctx.branchName ? ' · ' + escapeHtml(ctx.branchName) : ''}</p>
  </div>
  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Item / category', escapeHtml(ctx.entityName))}
      ${row('Old status', escapeHtml(ctx.oldStatus))}
      ${row('New status', `<strong style="color:${ctx.newStatus.toLowerCase().includes('enabled') ? '#1d7c3a' : '#b00020'};">${escapeHtml(ctx.newStatus)}</strong>`)}
      ${row('Changed by', `${escapeHtml(ctx.actorName ?? ctx.actorEmail ?? 'unknown')} <span style="color:#888">(${escapeHtml(ctx.actorRole)})</span>`)}
      ${ctx.reason ? row('Reason', escapeHtml(ctx.reason)) : ''}
      ${row('Timestamp', ctx.timestamp.toISOString())}
    </table>
    ${ctx.detailUrl ? `<p style="margin-top:18px;"><a href="${escapeAttr(ctx.detailUrl)}" style="display:inline-block;padding:10px 16px;background:#b34a00;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">View in admin →</a></p>` : ''}
    <p style="margin-top:18px;color:#888;font-size:11px;">You are receiving this because you administer this restaurant or are a Reshee Tech Super Admin. Repeated toggles within a ${DEBOUNCE_WINDOW_MIN}-minute window are bundled into a single alert to keep your inbox quiet.</p>
  </div>
</div>`.trim();

  return { subject, html, text };
}

export interface IntegrationAlertCtx {
  provider: string;          // e.g. "razorpay" | "twilio" | "smtp.sendgrid"
  category: string;          // human-readable: "Payment gateway" | "SMS provider" | …
  restaurantName: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string;
  timestamp: Date;
  changedFields: Record<string, { from: string; to: string }>; // already masked
  testStatus?: 'pass' | 'fail' | null;
  testError?: string | null;
  detailUrl?: string | null;
}

export function formatIntegrationEmail(ctx: IntegrationAlertCtx): { subject: string; html: string; text: string } {
  const action = ctx.testStatus === 'fail' ? 'Test failed' : ctx.testStatus === 'pass' ? 'Updated and tested OK' : 'Settings changed';
  const subject = `[${ctx.restaurantName}] ${ctx.category} integration: ${action}`;

  const fieldRows = Object.entries(ctx.changedFields)
    .map(([k, v]) => row(k, `<code style="background:#f4f4f4;padding:1px 6px;border-radius:3px;font-family:monospace;font-size:12px;">${escapeHtml(v.from)} → ${escapeHtml(v.to)}</code>`))
    .join('');

  const text = [
    `${action} — ${ctx.category} (${ctx.provider})`,
    ``,
    `Restaurant: ${ctx.restaurantName}`,
    `Changed by: ${ctx.actorName ?? ctx.actorEmail ?? 'unknown'} (${ctx.actorRole})`,
    `Timestamp: ${ctx.timestamp.toISOString()}`,
    ctx.testStatus ? `Test status: ${ctx.testStatus.toUpperCase()}` : null,
    ctx.testError ? `Test error: ${ctx.testError}` : null,
    ``,
    `Changes (masked):`,
    ...Object.entries(ctx.changedFields).map(([k, v]) => `  ${k}: ${v.from} → ${v.to}`)
  ].filter(Boolean).join('\n');

  const warn = ctx.testStatus === 'fail';

  const html = `
<div style="font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
  <div style="padding:24px;background:${warn ? '#fff5f5' : '#f7faff'};border-bottom:1px solid ${warn ? '#fbd6d6' : '#d6e5fb'};">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${warn ? '#b00020' : '#1d4ed8'};font-weight:600;">Integration ${warn ? 'WARNING' : 'change'}</div>
    <h2 style="margin:6px 0 0;font-size:20px;color:#1a1a1a;">${escapeHtml(action)} — ${escapeHtml(ctx.category)}</h2>
    <p style="margin:6px 0 0;color:#555;font-size:13px;">at <strong>${escapeHtml(ctx.restaurantName)}</strong> · provider <code style="background:#eee;padding:1px 6px;border-radius:3px;">${escapeHtml(ctx.provider)}</code></p>
  </div>
  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Changed by', `${escapeHtml(ctx.actorName ?? ctx.actorEmail ?? 'unknown')} <span style="color:#888">(${escapeHtml(ctx.actorRole)})</span>`)}
      ${row('Timestamp', ctx.timestamp.toISOString())}
      ${ctx.testStatus ? row('Test status', `<strong style="color:${ctx.testStatus === 'pass' ? '#1d7c3a' : '#b00020'};">${escapeHtml(ctx.testStatus.toUpperCase())}</strong>`) : ''}
      ${ctx.testError ? row('Test error', `<span style="color:#b00020">${escapeHtml(ctx.testError)}</span>`) : ''}
    </table>
    <div style="margin-top:18px;padding:14px;border:1px solid #eee;border-radius:6px;background:#fafafa;">
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px;">Changes (masked)</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${fieldRows}</table>
    </div>
    ${ctx.detailUrl ? `<p style="margin-top:18px;"><a href="${escapeAttr(ctx.detailUrl)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Review in admin →</a></p>` : ''}
    <p style="margin-top:18px;color:#888;font-size:11px;">Sensitive values are masked. Full credentials are never sent over email — to inspect or rotate them, sign in to the admin console.</p>
  </div>
</div>`.trim();

  return { subject, html, text };
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;color:#666;width:42%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#1a1a1a;">${value}</td></tr>`;
}
function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s: any): string { return escapeHtml(s).replace(/"/g, '&quot;'); }

// ── Debounce check (pure given a lastSentAt) ──────────────────────────────

export function isDebouncedNow(lastSentAt: Date | null, now: Date = new Date(), windowMin = DEBOUNCE_WINDOW_MIN): boolean {
  if (!lastSentAt) return false;
  return now.getTime() - new Date(lastSentAt).getTime() < windowMin * 60_000;
}

// ── Recipient resolution (DB-aware) ───────────────────────────────────────

export async function recipientsForRestaurant(restaurantId: string | null): Promise<string[]> {
  // ADMINs scoped to this restaurant (RestaurantUser ADMIN rows + the owner)
  // plus every SUPER_ADMIN user with an email. Returns deduped email addresses.
  const set = new Set<string>();
  if (restaurantId) {
    const rest = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        owner: { select: { email: true } },
        members: { where: { role: 'ADMIN' }, include: { user: { select: { email: true } } } }
      }
    });
    if (rest?.owner?.email) set.add(rest.owner.email);
    rest?.members.forEach((m) => m.user?.email && set.add(m.user.email));
    if (rest?.contactEmail) set.add(rest.contactEmail);
  }
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', email: { not: null } },
    select: { email: true }
  });
  superAdmins.forEach((u) => u.email && set.add(u.email));
  return Array.from(set);
}

// ── Debounce-aware senders ────────────────────────────────────────────────

async function checkAndStamp(entityType: string, entityId: string, kind: string, payload: any): Promise<{ skipped: boolean }> {
  const existing = await (prisma as any).alertDebounce.findUnique({
    where: { entityType_entityId_kind: { entityType, entityId, kind } }
  });
  if (existing && isDebouncedNow(existing.lastSentAt)) {
    return { skipped: true };
  }
  const now = new Date();
  await (prisma as any).alertDebounce.upsert({
    where: { entityType_entityId_kind: { entityType, entityId, kind } },
    update: { lastSentAt: now, payload },
    create: { entityType, entityId, kind, lastSentAt: now, payload }
  });
  return { skipped: false };
}

export interface SendMenuToggleOpts extends MenuToggleAlertCtx {
  restaurantId: string;
  kind: 'item' | 'category' | 'combo' | 'bulk';
}

export async function sendMenuToggleAlert(opts: SendMenuToggleOpts): Promise<{ sent: boolean; recipients: string[]; reason?: string }> {
  const debounceKind = `menu.${opts.kind}.toggle`;
  const gate = await checkAndStamp(opts.entityType, opts.entityId, debounceKind, {
    oldStatus: opts.oldStatus, newStatus: opts.newStatus, actor: opts.actorName ?? opts.actorEmail
  }).catch((e) => {
    log.error({ err: (e as Error).message }, 'alert debounce check failed');
    return { skipped: false };
  });
  if (gate.skipped) return { sent: false, recipients: [], reason: 'debounced' };

  const recipients = await recipientsForRestaurant(opts.restaurantId);
  if (recipients.length === 0) return { sent: false, recipients: [], reason: 'no recipients' };

  const { subject, html, text } = formatAvailabilityEmail(opts);

  // Fire one email per recipient — notify.email writes its own NotificationLog
  // entries. We don't await all of them serially in production code, but
  // sequencing keeps the call simple and rare (this is admin-side, low volume).
  for (const to of recipients) {
    await notify.email({
      to, subject, body: html, template: `alert.${debounceKind}`,
      restaurantId: opts.restaurantId,
      meta: { text, payload: { ...opts, timestamp: opts.timestamp.toISOString() } }
    }).catch((e) => log.error({ err: (e as Error).message, to }, 'alert email failed'));
  }
  return { sent: true, recipients };
}

export interface SendIntegrationAlertOpts extends IntegrationAlertCtx {
  restaurantId: string;
  integrationId: string;
}

export async function sendIntegrationAlert(opts: SendIntegrationAlertOpts): Promise<{ sent: boolean; recipients: string[]; reason?: string }> {
  const debounceKind = opts.testStatus ? 'integration.test' : 'integration.update';
  const gate = await checkAndStamp('IntegrationCredential', opts.integrationId, debounceKind, {
    fields: Object.keys(opts.changedFields), testStatus: opts.testStatus
  }).catch((e) => {
    log.error({ err: (e as Error).message }, 'integration debounce check failed');
    return { skipped: false };
  });
  if (gate.skipped) return { sent: false, recipients: [], reason: 'debounced' };

  const recipients = await recipientsForRestaurant(opts.restaurantId);
  if (recipients.length === 0) return { sent: false, recipients: [], reason: 'no recipients' };

  const { subject, html, text } = formatIntegrationEmail(opts);

  for (const to of recipients) {
    await notify.email({
      to, subject, body: html, template: `alert.${debounceKind}`,
      restaurantId: opts.restaurantId,
      meta: { text, provider: opts.provider, category: opts.category, testStatus: opts.testStatus }
    }).catch((e) => log.error({ err: (e as Error).message, to }, 'integration alert email failed'));
  }
  return { sent: true, recipients };
}
