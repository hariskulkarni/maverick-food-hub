import { requireManagedRestaurant } from '@/server/tenancy';
import { RecoveryClient } from './recovery-client';

export const metadata = { title: 'Admin · Service recovery' };
export const dynamic = 'force-dynamic';

export default async function ServiceRecoveryPage() {
  await requireManagedRestaurant();
  return <RecoveryClient />;
}
