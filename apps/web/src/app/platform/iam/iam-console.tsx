'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { UserPlus, Loader2, ShieldOff, ShieldCheck, KeyRound } from 'lucide-react';

interface Row {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  createdAt: string;
  capabilities: string[];
  editable: boolean;
}
interface AssignableRole { role: string; label: string; capabilities: string[] }

const ROLE_STYLE: Record<string, string> = {
  SUPER_ADMIN: 'bg-destructive/10 text-destructive border-destructive/30',
  ADMIN_ASSIST: 'bg-primary/10 text-primary border-primary/30',
  DEVELOPER: 'bg-primary/10 text-primary border-primary/30',
  QA: 'bg-warning/10 text-warning border-warning/30',
  GUEST: 'bg-muted text-muted-foreground border-border',
};
const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ADMIN_ASSIST: 'Admin Assist', DEVELOPER: 'Developer', QA: 'QA', GUEST: 'Guest',
};

export function IamConsole({ initial, assignable }: { initial: Row[]; assignable: AssignableRole[] }) {
  const router = useRouter();
  const [rows] = useState<Row[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  // create form
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(assignable[0]?.role ?? 'GUEST');
  const [creating, setCreating] = useState(false);

  const selectedCaps = assignable.find((a) => a.role === role)?.capabilities ?? [];

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) { toast.error('Password must be at least 12 characters.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/platform/iam/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message || data.error || 'Could not create user.'); return; }
      toast.success(`${name} created as ${ROLE_LABEL[role] ?? role}.`);
      setName(''); setEmail(''); setPassword(''); setOpen(false);
      router.refresh();
    } catch { toast.error('Network error creating user.'); }
    finally { setCreating(false); }
  }

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/iam/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message || data.error || 'Update failed.'); return; }
      toast.success(ok);
      router.refresh();
    } catch { toast.error('Network error.'); }
    finally { setBusyId(null); }
  }

  return (
    <div className="space-y-5">
      {/* Create */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Team members</h2>
              <p className="text-sm text-muted-foreground">Platform-team accounts you manage. Restaurant staff, customers and riders live elsewhere.</p>
            </div>
            <Button onClick={() => setOpen((v) => !v)} variant={open ? 'outline' : 'default'}>
              <UserPlus className="size-4 mr-1.5" /> {open ? 'Cancel' : 'Add member'}
            </Button>
          </div>

          {open && (
            <form onSubmit={createUser} className="mt-4 grid gap-3 md:grid-cols-2 border-t pt-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Full name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Asha Menon" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email (login)</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="asha@flavrly.in" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Temporary password</label>
                <div className="relative">
                  <KeyRound className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-8" type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} placeholder="min 12 characters" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {assignable.map((a) => (
                    <option key={a.role} value={a.role}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-1.5">
                {selectedCaps.map((c) => (
                  <span key={c} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{c}</span>
                ))}
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={creating}>
                  {creating ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <UserPlus className="size-4 mr-1.5" />}
                  Create member
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 hidden lg:table-cell">Capabilities</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const suspended = Boolean(u.suspendedAt);
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className="border-b last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {u.editable ? (
                        <select
                          defaultValue={u.role}
                          disabled={busy}
                          onChange={(e) => { if (e.target.value !== u.role) patch(u.id, { role: e.target.value }, `Role changed to ${ROLE_LABEL[e.target.value] ?? e.target.value}.`); }}
                          className={`h-8 rounded-full border px-2 text-[11px] font-medium ${ROLE_STYLE[u.role] ?? ''}`}
                        >
                          {assignable.map((a) => <option key={a.role} value={a.role}>{a.label}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${ROLE_STYLE[u.role] ?? ''}`}>{ROLE_LABEL[u.role] ?? u.role}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {u.capabilities.map((c) => (
                          <span key={c} className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{c}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {suspended
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30 px-2 py-0.5 text-[10px] font-medium"><ShieldOff className="size-3" /> Suspended</span>
                        : <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success border border-success/30 px-2 py-0.5 text-[10px] font-medium"><ShieldCheck className="size-3" /> Active</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.editable ? (
                        suspended ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => patch(u.id, { suspended: false }, 'Member reinstated.')}>
                            {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Reinstate'}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="text-destructive" disabled={busy}
                            onClick={() => { if (confirm(`Suspend ${u.name ?? u.email}? They'll be logged out everywhere.`)) patch(u.id, { suspended: true }, 'Member suspended.'); }}>
                            {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Suspend'}
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Protected</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No team members yet. Add your first one above.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
