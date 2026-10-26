import { requireManagedRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/integrations';
import { YoupiRequest } from './youpi-request';

export const metadata = { title: 'Admin · Flavrly PG UPI (Experimental)' };
export const dynamic = 'force-dynamic';

export default async function YoupiSettingsPage() {
  const restaurant = await requireManagedRestaurant();
  const fr = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId: restaurant.id } });
  const cfg = fr?.status === 'APPROVED' ? await getConfig(restaurant.id, 'YOUPI') : null;
  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <YoupiRequest
        status={(fr?.status ?? 'NONE') as 'NONE' | 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'DISABLED'}
        receivingVpa={cfg?.receivingVpa ?? ''}
        pendingVpa={cfg?.pendingReceivingVpa ?? ''}
      />
    </div>
  );
}
