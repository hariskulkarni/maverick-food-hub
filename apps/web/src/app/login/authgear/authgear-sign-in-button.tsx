'use client';

/**
 * Client component that kicks off the OIDC flow against the Authgear provider
 * we registered in apps/web/src/server/auth.ts. NextAuth handles every part of
 * the dance — redirect, code exchange, id_token validation, session creation.
 *
 * On success, it redirects to /login/authgear/result where we display the
 * claims. The provider id is 'authgear' — match the one in auth.ts exactly.
 */
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export function AuthgearSignInButton({ enabled }: { enabled: boolean }) {
  return (
    <Button
      size="lg"
      onClick={() => signIn('authgear', { callbackUrl: '/login/authgear/result' })}
      disabled={!enabled}
      className="w-full sm:w-auto"
    >
      {enabled ? 'Sign in with Authgear' : 'Provider not configured'}
    </Button>
  );
}
