import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { Card, CardContent } from '@/components/ui/card';
import { ResetPasswordClient } from './reset-password-client';

export const metadata = { title: 'Reset password', robots: { index: false, follow: false } };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="gradient-hero">
      <div className="container py-6 md:py-10 max-w-md">
        <div className="mb-6">
          <Link href="/" className="inline-flex items-center min-h-11">
            <BrandMark className="text-base" />
          </Link>
        </div>
        <div className="text-center mb-6">
          <h1 className="display text-2xl md:text-3xl font-semibold tracking-tight">Choose a new password</h1>
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-6">
            <ResetPasswordClient token={sp.token ?? ''} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
