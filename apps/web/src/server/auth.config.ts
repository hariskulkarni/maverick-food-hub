/**
 * Edge-safe NextAuth configuration: no Node-only providers/argon2/db imports.
 * Used by middleware (which runs on the edge runtime).
 */
import type { NextAuthConfig } from 'next-auth';

export const authEdgeConfig: NextAuthConfig = {
  trustHost: true,
  // Session lifetime. 8h hard cap with a 15-min rolling renewal: any
  // authenticated request older than `updateAge` re-issues the cookie and
  // slides expiry forward, so an actively-open admin tab (order/kitchen boards
  // poll on a timer) stays signed in through long tasks like the
  // create-restaurant wizard — which previously died on the old fixed 25-min
  // window. Security is still bounded server-side: every request re-checks the
  // single-active-session id (isSessionActive), so a superseded or revoked
  // session is rejected immediately regardless of this window.
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60, updateAge: 15 * 60 },
  pages: { signIn: '/login' },
  providers: [], // populated in `auth.ts`
  callbacks: {
    async jwt({ token }) { return token; },
    async session({ session, token }) {
      // Surface role/uid from the token; the heavy lookup happens in node-side auth.
      const s = session as any;
      s.user.id = (token.uid as string) ?? '';
      s.user.role = (token.role as string) ?? 'CUSTOMER';
      s.user.phone = (token.phone as string | null) ?? null;
      s.user.email = (token.email as string | null) ?? null;
      s.user.name = (token.name as string | null) ?? null;
      s.user.branchId = (token.branchId as string | null) ?? null;
      return s;
    }
  }
};
