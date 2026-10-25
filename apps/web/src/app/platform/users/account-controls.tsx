'use client';
/**
 * Super-admin account-recovery controls for ANY user (drawer in /platform/users):
 * temporary / chosen password (forced change at next login), authenticator
 * reset, unlock, sign out everywhere, role change, and recent activity.
 * Server: POST /api/platform/users/[id]/admin, GET .../activity.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Copy, KeyRound, Loader2, LogOut, LockOpen, ShieldAlert, UserCog, History } from 'lucide-react';
import { toast } from 'sonner';

const ALL_ROLES = ['CUSTOMER', 'RIDER', 'KITCHEN', 'ADMIN', 'ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST', 'SUPER_ADMIN'] as const;
const TOTP_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'KITCHEN', 'ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST']);

export interface AccountUser {
  id: string;
  role: string;
  email: string | null;
  phone: string | null;
  hasPassword?: boolean;
  totpEnrolled?: boolean;
  mustChangePassword?: boolean;
}

async function adminAction(userId: string, body: Record<string, unknown>): Promise<any | null> {
  try {
    const r = await fetch(`/api/platform/users/${userId}/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error(d.error || 'That did not work. Please try again.');
      return null;
    }
    return d;
  } catch {
    toast.error('Could not reach the server. Please try again.');
    return null;
  }
}

export function AccountControls({ user, onChange }: { user: AccountUser; onChange: () => void }) {
  const totpRole = TOTP_ROLES.has(user.role);
  return (
    <div className="divide-y">
      <PasswordControl user={user} onChange={onChange} />
      {totpRole && <AuthenticatorControl user={user} onChange={onChange} />}
      <QuickActions user={user} onChange={onChange} />
      <RoleControl user={user} onChange={onChange} />
      <ActivityPanel userId={user.id} />
    </div>
  );
}

function PasswordControl({ user, onChange }: { user: AccountUser; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const phoneOnly = user.role === 'CUSTOMER' || user.role === 'RIDER';

  async function run(password?: string) {
    const what = password ? 'set this password' : 'generate a temporary password';
    if (!window.confirm(`Reset this user's password and ${what}? They are signed out everywhere and must choose a new password at their next login.`)) return;
    setBusy(true);
    const d = await adminAction(user.id, { action: 'reset_password', ...(password ? { password } : {}) });
    setBusy(false);
    if (!d) return;
    setCustom('');
    setShowCustom(false);
    if (d.tempPassword) setTemp(d.tempPassword);
    else toast.success('Password set. They must change it at next login.');
    onChange();
  }

  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 font-medium"><KeyRound className="size-4 text-muted-foreground" /> Password</div>
      {phoneOnly && (
        <p className="text-xs text-muted-foreground">This role signs in with a phone OTP. A password only matters if they also use email + password sign-in.</p>
      )}
      {user.mustChangePassword && <Badge variant="warning" className="text-[10px]">Must change password at next login</Badge>}
      {temp ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2" role="status">
          <div className="text-xs text-muted-foreground">Temporary password — shown once. Share it with the user over a trusted channel.</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-base tracking-wider break-all">{temp}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(temp); toast.success('Copied'); }}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setTemp(null)}>Done — hide it</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Generate temporary password
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowCustom((v) => !v)}>Set a specific password</Button>
        </div>
      )}
      {showCustom && !temp && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="password" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="At least 12 characters" autoComplete="new-password" className="h-9" />
          <Button size="sm" disabled={busy || custom.length < 12} onClick={() => run(custom)}>Set password</Button>
        </div>
      )}
    </div>
  );
}

function AuthenticatorControl({ user, onChange }: { user: AccountUser; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function reset() {
    if (!window.confirm("Reset this user's Google Authenticator? They are signed out and scan a fresh QR code at their next login.")) return;
    setBusy(true);
    const d = await adminAction(user.id, { action: 'reset_totp' });
    setBusy(false);
    if (d) { toast.success('Authenticator reset — they will set it up again at next login.'); onChange(); }
  }
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4 text-muted-foreground" /> Google Authenticator</div>
      <p className="text-xs text-muted-foreground">
        {user.totpEnrolled ? 'Enrolled.' : 'Not enrolled yet — they set it up at their next login.'} Lost device? Reset it here.
      </p>
      <Button size="sm" variant="outline" disabled={busy || !user.totpEnrolled} onClick={reset}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />} Reset authenticator
      </Button>
    </div>
  );
}

function QuickActions({ user, onChange }: { user: AccountUser; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(action: 'unlock' | 'sign_out', confirmText: string, done: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(action);
    const d = await adminAction(user.id, { action });
    setBusy(null);
    if (d) { toast.success(done); onChange(); }
  }
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="font-medium">Access</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!!busy}
          onClick={() => run('unlock', 'Clear failed-login and OTP lockouts for this user?', 'Lockouts cleared.')}>
          {busy === 'unlock' ? <Loader2 className="size-3.5 animate-spin" /> : <LockOpen className="size-3.5" />} Unlock sign-in
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy}
          onClick={() => run('sign_out', 'Sign this user out of every device now?', 'Signed out everywhere.')}>
          {busy === 'sign_out' ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />} Sign out everywhere
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Failed-login lockouts also expire on their own after the configured lockout window.</p>
    </div>
  );
}

function RoleControl({ user, onChange }: { user: AccountUser; onChange: () => void }) {
  const [role, setRole] = useState(user.role);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRole(user.role); }, [user.role]);
  async function save() {
    if (role === user.role) return;
    if (!window.confirm(`Change role from ${user.role} to ${role}? They are signed out everywhere.${role === 'SUPER_ADMIN' ? ' SUPER_ADMIN has full control of the platform.' : ''}`)) return;
    setBusy(true);
    const d = await adminAction(user.id, { action: 'set_role', role });
    setBusy(false);
    if (d) { toast.success(`Role changed to ${role}.`); onChange(); } else setRole(user.role);
  }
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="flex items-center gap-2 font-medium"><UserCog className="size-4 text-muted-foreground" /> Role</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-card px-2 text-sm" aria-label="Role">
          {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <Button size="sm" disabled={busy || role === user.role} onClick={save}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Change role
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Restaurant roles (ADMIN / KITCHEN) also need restaurant membership — add it from the restaurant&apos;s team section.</p>
    </div>
  );
}

function ActivityPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<{ sessions: any[]; events: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/platform/users/${userId}/activity`, { cache: 'no-store' }).catch(() => null);
    if (r?.ok) setData(await r.json());
    else toast.error('Could not load activity.');
  }, [userId]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  return (
    <div className="p-4 space-y-2 text-sm">
      <button type="button" className="flex min-h-11 items-center gap-2 font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <History className="size-4 text-muted-foreground" /> Recent sign-ins &amp; audit events {open ? '▾' : '▸'}
      </button>
      {open && !data && <div className="text-xs text-muted-foreground"><Loader2 className="inline size-3.5 animate-spin" /> Loading…</div>}
      {open && data && (
        <div className="space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Sessions</div>
            {data.sessions.length === 0 ? <div className="text-xs text-muted-foreground">No sessions recorded.</div> : (
              <ul className="divide-y text-xs">
                {data.sessions.map((s) => (
                  <li key={s.id} className="py-2">
                    <div>{new Date(s.createdAt).toLocaleString('en-IN')} · {s.ipAddress ?? 'unknown IP'}</div>
                    <div className="text-muted-foreground truncate">{s.userAgent ?? '—'}</div>
                    <div className="text-muted-foreground">{s.revokedAt ? `Ended: ${s.revokedReason ?? 'revoked'}` : 'Active'}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Events</div>
            {data.events.length === 0 ? <div className="text-xs text-muted-foreground">No events.</div> : (
              <ul className="divide-y text-xs">
                {data.events.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="font-mono break-all">{e.action}</div>
                    <div className="text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString('en-IN')}
                      {e.actorId && e.actorId !== userId ? ` · by ${e.actorRole ?? 'user'} ${String(e.actorId).slice(0, 8)}…` : ''}
                      {e.after?.reason ? ` · ${e.after.reason}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
