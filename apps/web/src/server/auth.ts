/**
 * Auth: NextAuth v5 with two flows.
 *  - phone-otp: customers and riders. OTP printed to dev console (mock), sent via SMS in prod.
 *  - email-password: admin and kitchen users. Argon2id-hashed passwords.
 *
 * Role enforcement happens here (in `authorize`) and again in middleware + route helpers.
 */

import NextAuth, { type NextAuthConfig, type Session } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import argon2 from 'argon2';
import { prisma } from './db';
import { Role } from '@prisma/client';
import { sendOtp, verifyOtp } from './otp';
import { authEdgeConfig } from './auth.config';
import {
  getPlatformSecurity,
  ipMatchesAllowlist,
  isLockedOut,
  recordLoginFailure,
  recordLoginSuccess,
  verifyTotp
} from './2fa';
import { audit } from './audit';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      branchId?: string | null;
    };
  }
}

export const authConfig: NextAuthConfig = {
  ...authEdgeConfig,
  providers: [
    Credentials({
      id: 'phone-otp',
      name: 'Phone OTP',
      credentials: {
        phone: { label: 'Phone', type: 'tel' },
        code: { label: 'Code', type: 'text' },
        purpose: { label: 'Purpose', type: 'text' }
      },
      async authorize(creds) {
        const phone = String(creds?.phone ?? '').trim();
        const code = String(creds?.code ?? '').trim();
        const purpose = String(creds?.purpose ?? 'login').trim();
        if (!phone || !code) return null;
        const ok = await verifyOtp({ phone, code, purpose });
        if (!ok) return null;
        // We need to know whether this is a *new* customer to decide whether
        // to issue a signup bonus, so check before upserting.
        const existing = await prisma.user.findUnique({ where: { phone } });
        const user = existing ?? await prisma.user.create({ data: { phone, role: Role.CUSTOMER } });
        if (!existing) {
          // First-time OTP verification = signup. Phone is known here (and is
          // the canonical anti-abuse key), so phone-based dedup works. IP isn't
          // surfaced through next-auth's authorize() — admins can opt-out of
          // IP checks via the SignupBonusConfig if they want a stricter mode.
          try {
            const { grantSignupBonus } = await import('./signup-bonus');
            await grantSignupBonus(user.id, { phone });
          } catch {}
        }
        return { id: user.id, name: user.name ?? null, email: user.email ?? null };
      }
    }),
    Credentials({
      id: 'email-password',
      name: 'Email + Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'TOTP', type: 'text' }
      },
      async authorize(creds, req) {
        const email = String(creds?.email ?? '').toLowerCase().trim();
        const password = String(creds?.password ?? '');
        const totp = String(creds?.totp ?? '').trim();
        if (!email || !password) return null;

        // Look up policy + lockout state up front. We read it before validating
        // the password so a brute-forcer can't bypass lockout by spamming.
        const sec = await getPlatformSecurity().catch(() => ({} as Awaited<ReturnType<typeof getPlatformSecurity>>));
        const lockoutMinutes = sec.lockoutMinutes ?? 15;
        if (isLockedOut(email)) {
          await audit('auth.login.locked', { entityType: 'User', after: { email } }).catch(() => {});
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
          recordLoginFailure(email, lockoutMinutes);
          return null;
        }
        if (user.role !== Role.ADMIN && user.role !== Role.KITCHEN && user.role !== Role.SUPER_ADMIN) return null;

        const ok = await argon2.verify(user.passwordHash, password);
        if (!ok) {
          recordLoginFailure(email, lockoutMinutes);
          await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'bad_password' } }).catch(() => {});
          return null;
        }

        // Super-admin extra gates: 2FA + IP allowlist.
        if (user.role === Role.SUPER_ADMIN) {
          // IP allowlist (NextAuth v5 passes a Web `Request` as the second arg).
          if (sec.allowlist && sec.allowlist.length > 0) {
            const fwd = req?.headers?.get?.('x-forwarded-for') ?? '';
            const ip = String(fwd || '').split(',')[0]!.trim();
            if (!ip || !ipMatchesAllowlist(ip, sec.allowlist)) {
              recordLoginFailure(email, lockoutMinutes);
              await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'ip_not_allowlisted', ip } }).catch(() => {});
              return null;
            }
          }
          // TOTP
          if (sec.totpSecret) {
            if (!totp || !verifyTotp(sec.totpSecret, totp)) {
              recordLoginFailure(email, lockoutMinutes);
              await audit('auth.login.failed', { actorId: user.id, entityType: 'User', entityId: user.id, after: { reason: 'totp_invalid' } }).catch(() => {});
              return null;
            }
          }
        }

        recordLoginSuccess(email);
        return { id: user.id, name: user.name ?? null, email: user.email ?? null };
      }
    }),
    // Google OAuth — customer sign-in on tenant login pages. Conditional on env so
    // local/dev builds without Google credentials still boot.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : [])
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Google flow: provision/lookup a User by email. New emails become CUSTOMER;
      // existing accounts keep whatever role they already have (so a kitchen user
      // who happens to use Google still gets KITCHEN, not CUSTOMER).
      if (account?.provider === 'google') {
        const email = (user.email ?? '').toLowerCase().trim();
        if (!email) return false;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          (user as any).id = existing.id;
          return true;
        }
        const created = await prisma.user.create({
          data: { email, name: user.name ?? null, role: Role.CUSTOMER }
        });
        (user as any).id = created.id;
        // Best-effort signup-bonus grant. Failures must not block signin.
        // Phone is unknown at Google-OAuth signup so we can't enforce the
        // phone abuse-check here; IP also isn't surfaced through next-auth's
        // signIn callback. Phone-based grants happen on first OTP verification.
        try {
          const { grantSignupBonus } = await import('./signup-bonus');
          await grantSignupBonus(created.id, { phone: null, ipAddress: null });
        } catch {}
        return true;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      if (token.uid) {
        const u = await prisma.user.findUnique({
          where: { id: token.uid as string },
          include: { branchMemberships: { take: 1 } }
        });
        if (u) {
          token.role = u.role;
          token.phone = u.phone;
          token.email = u.email;
          token.name = u.name;
          token.branchId = u.branchMemberships[0]?.branchId ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      const s = session as Session;
      s.user.id = (token.uid as string) ?? '';
      s.user.role = (token.role as Role) ?? Role.CUSTOMER;
      s.user.phone = (token.phone as string | null) ?? null;
      s.user.email = (token.email as string | null) ?? null;
      s.user.name = (token.name as string | null) ?? null;
      s.user.branchId = (token.branchId as string | null) ?? null;
      return s;
    }
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function requireRole(roles: Role[]): Promise<Session> {
  const session = await auth();
  if (!session?.user || !roles.includes(session.user.role)) {
    throw new Response('Forbidden', { status: 403 });
  }
  return session;
}

export { sendOtp };
