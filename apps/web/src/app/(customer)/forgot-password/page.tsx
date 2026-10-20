import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Card, CardContent } from '@/components/ui/card';
import { ForgotPasswordClient } from './forgot-password-client';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <div className="gradient-hero">
      <div className="container py-6 md:py-10 max-w-md">
        <div className="mb-6">
          <Link href="/" className="inline-flex items-center min-h-11">
            <BrandMark className="text-base" />
          </Link>
        </div>
        <div className="text-center mb-6">
          <h1 className="display text-2xl md:text-3xl font-semibold tracking-tight">Forgot your password?</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <ForgotPasswordClient />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
