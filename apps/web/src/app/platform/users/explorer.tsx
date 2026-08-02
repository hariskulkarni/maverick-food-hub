'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DetailDrawer, DrawerSection } from '@/components/admin/detail-drawer';
import { Search, Download, RefreshCw, Phone, Mail, MapPin, Wallet, Sparkles, Bell, ShoppingBag, ArrowUpRight, Plus, Minus, X, Loader2, ShieldOff, ShieldCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

type Role = 'CUSTOMER' | 'ADMIN' | 'KITCHEN' | 'RIDER' | 'SUPER_ADMIN';
const ROLES: Array<Role | 'ALL'> = ['ALL', 'CUSTOMER', 'RIDER', 'ADMIN', 'KITCHEN', 'SUPER_ADMIN'];
const PERIODS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: '7d',  label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
  { key: '90d', label: 'Last 90d' }
];

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  createdAt: string;
  _count: { orders: number };
}

export function UsersExplorer({ initial, filters }: { initial: UserRow[]; filters: { role: string; q: string; period: string } }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(filters.q);
  const [role, setRole] = useState<Role | 'ALL'>((filters.role || 'ALL') as any);
  const [period, setPeriod] = useState(filters.period);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Push URL when filters change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      sp.delete('q'); sp.delete('role'); sp.delete('period');
      if (q.trim()) sp.set('q', q.trim());
      if (role !== 'ALL') sp.set('role', role);
      if (period !== 'all') sp.set('period', period);
      router.replace(`/platform/users?${sp.toString()}`);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, role, period]);

  function exportCsv() {
    const head = ['ID', 'Name', 'Email', 'Phone', 'Role', 'Joined', 'Orders'];
    const rows = initial.map((u) => [
      u.id, u.name ?? '', u.email ?? '', u.phone ?? '', u.role,
      new Date(u.createdAt).toISOString(), u._count.orders
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <>
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, or phone" className="pl-9" />
              {q && (
                <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {ROLES.map((r) => (
                <Chip key={r} active={role === r} onClick={() => setRole(r)}>
                  {r === 'ALL' ? 'All roles' : prettyRole(r)}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-auto">
              {PERIODS.map((p) => (
                <Chip key={p.key} active={period === p.key} onClick={() => setPeriod(p.key)}>
                  {p.label}
                </Chip>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={() => router.refresh()}><RefreshCw className="size-4" /> Refresh</Button>
          </div>
          <div className="text-xs text-muted-foreground">{initial.length} {initial.length === 1 ? 'user' : 'users'} match</div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <Th>Person</Th>
                  <Th>Contact</Th>
                  <Th>Role</Th>
                  <Th align="right">Orders</Th>
                  <Th>Joined</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {initial.length === 0 && (
                  <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No users match these filters.</td></tr>
                )}
                {initial.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setActiveId(u.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name ?? u.phone ?? u.email ?? '—'} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{u.name || '—'}</div>
                          <div className="text-[11px] text-muted-foreground">{u.id.slice(0, 12)}…</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u.phone && <div className="font-mono">{u.phone}</div>}
                      {u.email && <div className="text-muted-foreground truncate">{u.email}</div>}
                    </td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 text-right font-mono">{u._count.orders}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveId(u.id); }}>
                        Details <ArrowUpRight className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {activeId && <UserDrawer id={activeId} onClose={() => setActiveId(null)} />}
    </>
  );
}

// ─── User detail drawer ────────────────────────────────────────────────────
function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/platform/users/${id}`, { cache: 'no-store' });
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return (
      <DetailDrawer open onOpenChange={(v) => !v && onClose()} title="Loading…">
        <div className="grid place-items-center h-40 text-muted-foreground"><Loader2 className="size-6 animate-spin" /></div>
      </DetailDrawer>
    );
  }

  const u = data.user;
  return (
    <DetailDrawer
      open
      onOpenChange={(v) => !v && onClose()}
      title={u.name || u.email || u.phone || 'Unnamed'}
      subtitle={`Joined ${new Date(u.createdAt).toLocaleDateString('en-IN', { dateStyle: 'long' })} · ID ${u.id.slice(0, 12)}…`}
      badge={<RoleBadge role={u.role} />}
      width="640px"
    >
      {/* Contact */}
      <DrawerSection title="Contact">
        <div className="p-4 space-y-2 text-sm">
          {u.phone && <div className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /> <span className="font-mono">{u.phone}</span></div>}
          {u.email && <div className="flex items-center gap-2"><Mail  className="size-4 text-muted-foreground" /> {u.email}</div>}
          {!u.phone && !u.email && <div className="text-xs text-muted-foreground">No contact info on file.</div>}
        </div>
      </DrawerSection>

      {/* Account status — suspend / reinstate */}
      <DrawerSection title="Account status">
        <SuspensionControl
          userId={u.id}
          suspendedAt={u.suspendedAt ?? null}
          suspendedReason={u.suspendedReason ?? null}
          onChange={load}
        />
      </DrawerSection>

      {/* Two-factor (Google Authenticator) — staff only. Super-admin reset. */}
      {(u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' || u.role === 'KITCHEN') && (
        <DrawerSection title="Two-factor (Google Authenticator)">
          <TotpResetControl userId={u.id} />
        </DrawerSection>
      )}

      {/* Customer metrics — only meaningful for customers */}
      {u.role === 'CUSTOMER' && (
        <>
          <DrawerSection title="Lifetime value">
            <div className="grid grid-cols-3 divide-x">
              <Cell label="GMV"     value={`₹${Number(data.lifetime.gmv).toLocaleString('en-IN')}`} />
              <Cell label="Orders"  value={String(data.lifetime.orderCount)} />
              <Cell label="AOV"     value={data.lifetime.orderCount > 0 ? `₹${Math.round(data.lifetime.gmv / data.lifetime.orderCount)}` : '—'} />
            </div>
          </DrawerSection>

          <DrawerSection title="Wallet & loyalty">
            <div className="grid grid-cols-2 divide-x">
              <div className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Wallet className="size-3.5" /> Wallet balance</div>
                <div className="text-xl font-bold mt-1">₹{Number(data.wallet?.balance ?? 0).toLocaleString('en-IN')}</div>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Sparkles className="size-3.5" /> Loyalty</div>
                <div className="text-xl font-bold mt-1">{data.loyalty?.pointsBalance ?? 0} <span className="text-xs font-normal text-muted-foreground">pts</span></div>
                <div className="text-[10px] text-muted-foreground">Lifetime earned {data.loyalty?.lifetimeEarn ?? 0}</div>
              </div>
            </div>
            <WalletAdjust userId={u.id} currentBalance={Number(data.wallet?.balance ?? 0)} onChange={load} />
          </DrawerSection>

          {data.addresses.length > 0 && (
            <DrawerSection title={`Addresses (${data.addresses.length})`}>
              <ul className="divide-y text-sm">
                {data.addresses.map((a: any) => (
                  <li key={a.id} className="p-3 flex items-start gap-2">
                    <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium">{a.label || 'Address'}</div>
                      <div className="text-xs text-muted-foreground">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.postalCode}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {data.orders.length > 0 && (
            <DrawerSection title={`Recent orders (${data.orders.length})`}>
              <ul className="divide-y text-sm">
                {data.orders.slice(0, 10).map((o: any) => (
                  <li key={o.id} className="p-3 flex items-center gap-3">
                    <ShoppingBag className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs">{o.code}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{o.branch.restaurant.name} · {new Date(o.placedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</div>
                    </div>
                    <Badge variant="muted" className="text-[10px]">{o.status}</Badge>
                    <div className="font-semibold tabular-nums w-16 text-right">₹{Number(o.total).toLocaleString('en-IN')}</div>
                  </li>
                ))}
              </ul>
            </DrawerSection>
          )}
        </>
      )}

      {/* Rider profile */}
      {u.role === 'RIDER' && data.riderProfile && (
        <DrawerSection title="Rider profile">
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <Cell label="Status" value={data.riderProfile.isOnline ? 'Online' : 'Offline'} />
            <Cell label="Vehicle" value={`${data.riderProfile.vehicleType} ${data.riderProfile.vehicleNumber ?? ''}`} />
            <Cell label="Deliveries" value={String(data.riderProfile.totalDeliveries)} />
            <Cell label="Earnings"   value={`₹${Number(data.riderProfile.totalEarnings).toLocaleString('en-IN')}`} />
            <Cell label="Tips"       value={`₹${Number(data.riderProfile.totalTips).toLocaleString('en-IN')}`} />
            <Cell label="Rating"     value={`⭐ ${Number(data.riderProfile.rating ?? 0).toFixed(1)}`} />
          </div>
        </DrawerSection>
      )}

      {/* Recent notifications */}
      {data.notifications.length > 0 && (
        <DrawerSection title="Recent notifications">
          <ul className="divide-y text-xs">
            {data.notifications.slice(0, 8).map((n: any) => (
              <li key={n.id} className="p-3 flex items-start gap-2">
                <Bell className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{n.subject || n.template || n.channel}</div>
                  <div className="text-muted-foreground text-[10px]">{new Date(n.createdAt).toLocaleString('en-IN')}</div>
                </div>
                <Badge variant={n.status === 'SENT' ? 'success' : n.status === 'FAILED' ? 'destructive' : 'warning'} className="text-[9px]">{n.status}</Badge>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </DetailDrawer>
  );
}

function TotpResetControl({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function reset() {
    if (!window.confirm('Reset this staff member\'s Google Authenticator? They will set it up again on their next login.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/platform/users/${userId}/reset-totp`, { method: 'POST' });
      if (r.ok) {
        setDone(true);
        toast.success('2FA reset — they will re-enroll Google Authenticator on next login.');
      } else {
        const d = await r.json().catch(() => ({}));
        toast.error(d.error || 'Could not reset 2FA.');
      }
    } catch {
      toast.error('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-4 space-y-2 text-sm">
      <p className="text-xs text-muted-foreground">
        If this staff member lost their authenticator device, reset it here. On their next login they&apos;ll
        scan a fresh QR to set up Google Authenticator again.
      </p>
      <Button size="sm" variant="outline" disabled={busy || done} onClick={reset}>
        {done ? '2FA reset \u2713' : busy ? 'Resetting\u2026' : 'Reset Google Authenticator'}
      </Button>
    </div>
  );
}

function SuspensionControl({
  userId,
  suspendedAt,
  suspendedReason,
  onChange
}: {
  userId: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  onChange: () => void;
}) {
  const isSuspended = Boolean(suspendedAt);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setSuspended(next: boolean) {
    setBusy(true);
    const r = await fetch(`/api/platform/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspended: next, ...(next ? { suspendReason: reason || undefined } : {}) })
    });
    setBusy(false);
    if (!r.ok) return toast.error(`Failed: ${await r.text()}`);
    toast.success(next ? 'Account suspended — user is logged out everywhere' : 'Account reinstated');
    setReason('');
    setConfirming(false);
    onChange();
  }

  if (isSuspended) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <ShieldOff className="size-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <div className="font-medium text-destructive">Suspended</div>
            <div className="text-xs text-muted-foreground">
              Since {new Date(suspendedAt!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {suspendedReason ? ` · ${suspendedReason}` : ''}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">Login is blocked and active sessions were terminated.</div>
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setSuspended(false)} className="text-success border-success/40 hover:bg-success/10">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Reinstate account
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-success">
        <ShieldCheck className="size-4" /> <span className="font-medium">Active</span>
      </div>
      {!confirming ? (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)} className="text-destructive border-destructive/40 hover:bg-destructive/10">
          <ShieldOff className="size-3.5" /> Suspend account
        </Button>
      ) : (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
            <span>Suspending blocks all logins and force-logs the user out of every device immediately. This is reversible.</span>
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (logged in audit trail)" className="h-9" />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setSuspended(true)} className="text-destructive border-destructive/40 hover:bg-destructive/10">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldOff className="size-3.5" />} Confirm suspend
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setConfirming(false); setReason(''); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WalletAdjust({ userId, currentBalance, onChange }: { userId: string; currentBalance: number; onChange: () => void }) {
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function apply(sign: 1 | -1) {
    if (!amount || amount <= 0) return;
    setBusy(true);
    const r = await fetch(`/api/platform/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletDelta: sign * amount, walletNote: note || (sign === 1 ? 'Admin credit' : 'Admin debit') })
    });
    setBusy(false);
    if (!r.ok) return toast.error(`Failed: ${await r.text()}`);
    toast.success(`Wallet ${sign === 1 ? 'credited' : 'debited'} ₹${amount}`);
    setAmount(0); setNote('');
    onChange();
  }
  return (
    <div className="border-t bg-muted/20 p-3 space-y-2">
      <div className="text-[11px] font-medium text-muted-foreground">Adjust balance (current ₹{currentBalance.toLocaleString('en-IN')})</div>
      <div className="flex gap-2">
        <Input type="number" min={1} step={1} value={amount || ''} onChange={(e) => setAmount(Number(e.target.value) || 0)} placeholder="Amount" className="w-28 h-9" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (logged)" className="h-9 flex-1" />
        <Button size="sm" variant="outline" disabled={!amount || busy} onClick={() => apply(1)} className="text-success border-success/40 hover:bg-success/10"><Plus className="size-3.5" /> Credit</Button>
        <Button size="sm" variant="outline" disabled={!amount || busy || amount > currentBalance} onClick={() => apply(-1)} className="text-destructive border-destructive/40 hover:bg-destructive/10"><Minus className="size-3.5" /> Debit</Button>
      </div>
    </div>
  );
}

// ─── small bits ─────────────────────────────────────────────────────────────
function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`text-${align} px-4 py-2.5 font-medium text-[11px] uppercase tracking-wider text-muted-foreground`}>{children}</th>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent text-muted-foreground'}`}>
      {children}
    </button>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold mt-0.5">{value}</div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const colors = ['bg-primary/15 text-primary', 'bg-success/15 text-success', 'bg-warning/15 text-warning'];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <div className={`size-9 shrink-0 grid place-items-center rounded-full font-semibold text-xs ${colors[idx]}`}>
      {initials || '?'}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const map: Record<Role, { cls: string; label: string }> = {
    SUPER_ADMIN: { cls: 'bg-destructive/10 text-destructive border-destructive/30', label: 'Super admin' },
    ADMIN:       { cls: 'bg-primary/10 text-primary border-primary/30',             label: 'Restaurant admin' },
    KITCHEN:     { cls: 'bg-warning/10 text-warning border-warning/30',             label: 'Kitchen' },
    RIDER:       { cls: 'bg-success/10 text-success border-success/30',             label: 'Rider' },
    CUSTOMER:    { cls: 'bg-muted text-muted-foreground',                           label: 'Customer' }
  };
  const m = map[role];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function prettyRole(r: Role) {
  return { SUPER_ADMIN: 'Admin', ADMIN: 'Owner', KITCHEN: 'Kitchen', RIDER: 'Rider', CUSTOMER: 'Customer' }[r];
}
