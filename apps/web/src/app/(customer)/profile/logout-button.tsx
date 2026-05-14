'use client';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

/**
 * Robust sign-out button. Works reliably inside Capacitor WebViews where the
 * default NextAuth redirect can hang:
 *   1. Call signOut({ redirect: false }) and swallow any error.
 *   2. Then unconditionally hard-navigate to /login.
 * So the user is always escorted out even if the cookie-clear request times out.
 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function handle() {
    if (busy) return;
    setBusy(true);
    try { await signOut({ redirect: false }).catch(() => {}); }
    finally { window.location.href = '/login'; }
  }
  return (
    <Button
      variant="outline"
      size="md"
      onClick={handle}
      disabled={busy}
      className="w-full justify-center gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive font-medium"
    >
      <LogOut className="size-4" />
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
