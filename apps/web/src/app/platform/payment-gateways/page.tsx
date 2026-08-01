import { requireSuperAdmin } from '@/server/tenancy';
import { PaymentGatewaysPanel } from './panel';

export const metadata = { title: 'Platform · Payment gateways' };
export const dynamic = 'force-dynamic';

/**
 * Super-admin payment-gateway console.
 *
 * Tenant admins configure their own gateway under Storefront CMS → Integrations,
 * but a SUPER_ADMIN holds no RestaurantUser grant, so those screens 404 for them.
 * This page targets any restaurant explicitly and reuses the same wizard, so
 * there is one code path for credentials, testing and encryption.
 */
export default async function PlatformPaymentGatewaysPage() {
  await requireSuperAdmin();
  return <PaymentGatewaysPanel />;
}
