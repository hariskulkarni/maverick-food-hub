'use client';
/**
 * Per-restaurant staff sign-in (email/password).
 *
 * After a successful sign-in:
 *   1. GET /api/me to read the role.
 *   2. GET /api/me/restaurants to confirm the signed-in user is a member of
 *      this restaurant slug.
 *   3. Route by role:
 *        ADMIN   → /admin
 *        KITCHEN → /admin/orders (kitchen panel lives there)
 *        other   → /r/<slug> with a toast
 *      …unless the membership check fails, in which case we show "you're
 *      signed in but not a member of this restaurant" with a Continue link.
 */
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type Membership = { restaurantId: string; slug: string; name: string; role: string };

export function StaffLoginClient({ slug, restaurantName }: { slug: string; restaurantName: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notMember, setNotMember] = useState(false);

  async function routeStaff() {
    // 1. Read the role.
    let role: string | null = null;
    try {
      const me = await (await fetch('/api/me', { cache: 'no-store' })).json();
      role = me?.role ?? null;
    } catch {
      // network error — fall through and let the membership check / fallback handle it
    }

    // 2. Confirm membership of *this* restaurant.
    let memberships: Membership[] = [];
    try {
      const res = await (await fetch('/api/me/restaurants', { cache: 'no-store' })).json();
      memberships = Array.isArray(res?.memberships) ? res.memberships : [];
    } catch {
      memberships = [];
    }
    const isMemberOfThis = memberships.some((m) => m.slug === slug);

    // 3a. Signed in but not a staff member of *any* restaurant role, or not staff at all.
    if (role !== 'ADMIN' && role !== 'KITCHEN') {
      toast.error(`This account is not a staff member of ${restaurantName}`);
      window.location.href = `/r/${slug}`;
      return;
    }

    // 3b. Staff role, but not a member of *this* restaurant.
    if (!isMemberOfThis) {
      setNotMember(true);
      return;
    }

    // 3c. Happy path — route by role.
    if (role === 'ADMIN') {
      window.location.href = '/admin';
    } else {
      // KITCHEN — kitchen panel lives inside /admin/orders
      window.location.href = '/admin/orders';
    }
  }

  async function loginEmail() {
    setBusy(true);
    const r = await signIn('email-password', { email, password, redirect: false });
    setBusy(false);
    if (r?.error) return toast.error('Invalid credentials');
    await routeStaff();
  }

  if (notMember) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-warning/5 border-warning/30 p-3 text-sm">
          You&apos;re signed in but not a member of this restaurant.
        </div>
        <Button asChild className="w-full" variant="outline">
          <a href={`/r/${slug}`}>Continue anyway</a>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        loginEmail();
      }}
    >
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <Button className="w-full" disabled={busy} type="submit">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
