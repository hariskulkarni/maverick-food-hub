'use client';
import { RouteError } from '@/components/observability/route-error';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} area="admin" />;
}
