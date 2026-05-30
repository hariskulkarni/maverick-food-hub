/**
 * Edge-safe NextAuth configuration: no Node-only providers/argon2/db imports.
 * Used by middleware (which runs on the edge runtime).
 */
import type { NextAuthConfig } from 'next-auth';

export const authEdgeConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 25 * 60 },
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
