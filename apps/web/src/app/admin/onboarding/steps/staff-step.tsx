'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { ChefHat, Copy, Crown, KeyRound, Loader2, ShieldCheck, UserPlus, Bike } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { validateEmail } from '@/lib/onboarding/validators';
import { StepFrame, Field, apiJson } from '../parts';
import type { StepProps } from '../wizard-client';

const ROLES = [
  {
    key: 'KITCHEN' as const, title: 'Kitchen staff', icon: ChefHat,
    can: ['See new orders the moment they arrive', 'Accept, mark ready and hand over to riders', 'Mark dishes out of stock'],
    cannot: ['Change prices, menu or settings', 'See payouts or reports'],
  },
  {
    key: 'ADMIN' as const, title: 'Manager (admin)', icon: Crown,
    can: ['Everything kitchen staff can do', 'Edit menu, prices, offers and settings', 'View reports and payouts'],
    cannot: ['Remove you as owner'],
  },
];

export function StaffStep({ data, complete, refresh }: StepProps) {
  const active = data.branches.filter((b) => b.isActive);
  const [f, setF] = useState({ name: '', email: '', role: 'KITCHEN' as 'KITCHEN' | 'ADMIN', branchId: active[0]?.id ?? '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ name: string; email: string; password: string } | null>(null);
  const errors = {
    name: f.name.trim().length >= 2 ? null : 'Enter their name, e.g. Ravi Kumar.',
    email: validateEmail(f.email, { required: true }),
  };
  const loginUrl = typeof window === 'undefined' ? `/r/${data.restaurant.slug}/staff` : `${window.location.origin}/r/${data.restaurant.slug}/staff`;

  async function invite() {
    setTouched(true);
    if (errors.name || errors.email) return;
    setBusy(true);
    const res = await apiJson<{ staff: { name: string; email: string }; tempPassword: string }>('/api/admin/onboarding/staff', 'POST', {
      name: f.name, email: f.email, role: f.role, branchId: f.role === 'KITCHEN' && f.branchId ? f.branchId : undefined,
    }, 'Could not add this team member');
    setBusy(false);
    if (res) {
      setIssued({ name: res.staff.name, email: res.staff.email, password: res.tempPassword });
      setF({ ...f, name: '', email: '' });
      setTouched(false);
      refresh();
    }
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed'));

  return (
    <StepFrame
      title="Staff & roles"
      intro="Give each person their own login instead of sharing yours. You can add more people any time."
      why="Orders ring on every logged-in kitchen screen, so nothing is missed when you are away. Separate logins also mean the activity log shows who changed what."
      example={<>Add <b>Ravi Kumar · ravi.kitchen@spicegarden.in · Kitchen staff</b>. He signs in at your staff link with the one-time password, sets up two-step verification, and sees only the orders board.</>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {ROLES.map((r) => (
          <button key={r.key} type="button" onClick={() => setF({ ...f, role: r.key })}
            className={cn('rounded-xl border p-4 text-left space-y-2', f.role === r.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent')}>
            <div className="flex items-center gap-2 font-semibold"><r.icon className="size-4 text-primary" /> {r.title}</div>
            <ul className="space-y-0.5 text-xs">
              {r.can.map((c) => <li key={c} className="text-success">✓ <span className="text-foreground">{c}</span></li>)}
              {r.cannot.map((c) => <li key={c} className="text-muted-foreground">✕ {c}</li>)}
            </ul>
          </button>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bike className="size-3.5" /> Delivery riders sign up separately — manage them under <a href="/admin/riders" className="text-primary underline">Dedicated Riders</a>.</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" required error={touched ? errors.name : null}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ravi Kumar" /></Field>
        <Field label="Email (their login)" required error={touched ? errors.email : null}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ravi.kitchen@spicegarden.in" /></Field>
        {f.role === 'KITCHEN' && active.length > 1 ? (
          <Field label="Kitchen at branch">
            <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        ) : <div className="hidden sm:block" />}
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={invite} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} Add {f.role === 'KITCHEN' ? 'kitchen staff' : 'manager'}</Button>
      </div>

      {issued && (
        <div className="rounded-xl border border-success/40 bg-success/5 p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold"><KeyRound className="size-4 text-success" /> Login for {issued.name} — shown only once</div>
          <div className="grid gap-1 font-mono text-xs break-all">
            <span>Sign in: {loginUrl}</span>
            <span>Email: {issued.email}</span>
            <span>Temporary password: {issued.password}</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => copy(`Sign in: ${loginUrl}\nEmail: ${issued.email}\nTemporary password: ${issued.password}`)}><Copy className="size-3.5" /> Copy login details</Button>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="size-3.5" /> Share it privately (in person or a direct message). They&apos;ll set up two-step verification on first sign-in.</p>
        </div>
      )}

      <div className="rounded-xl border p-4">
        <div className="text-sm font-medium mb-2">Your team ({data.staff.length})</div>
        <ul className="divide-y text-sm">
          {data.staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0"><div className="truncate font-medium">{s.name ?? s.email}</div><div className="truncate text-xs text-muted-foreground">{s.email}</div></div>
              <Badge variant={s.isOwner ? 'default' : 'muted'}>{s.isOwner ? 'Owner' : s.role === 'ADMIN' ? 'Manager' : 'Kitchen'}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-end">
        <Button onClick={complete}>{data.staff.length > 1 ? 'Continue' : 'Continue without staff'}</Button>
      </div>
    </StepFrame>
  );
}
