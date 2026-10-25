'use client';
import { RouteError } from '@/components/observability/route-error';

export default function CustomerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} area="customer" />;
}
