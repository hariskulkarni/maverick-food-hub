import { Badge } from '@/components/ui/badge';
import { STATUS_LABELS } from '@/lib/utils';

const VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' | 'muted'> = {
  RECEIVED: 'warning',
  ACCEPTED: 'default',
  PREPARING: 'default',
  READY: 'default',
  OUT_FOR_DELIVERY: 'default',
  DELIVERED: 'success',
  CANCELLED: 'destructive',
  REFUND_INITIATED: 'warning',
  REFUNDED: 'muted',
  PAYMENT_FAILED: 'destructive'
};

export function OrderStatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  return <Badge variant={VARIANT[status] ?? 'default'}>{STATUS_LABELS[status]}</Badge>;
}
