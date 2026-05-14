import { requireRestaurant } from '@/server/tenancy';
import { listForRestaurant } from '@/server/integrations';

export async function GET() {
  const restaurant = await requireRestaurant();
  const list = await listForRestaurant(restaurant.id);
  return Response.json(list);
}
