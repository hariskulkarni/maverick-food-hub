import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { NewAddressForm } from './form';

export const metadata = { title: 'Add address' };

export default async function NewAddressPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?next=/profile/addresses/new');
  return (
    <div className="container py-8 max-w-xl">
      <h1 className="display text-2xl font-semibold mb-4">Add address</h1>
      <NewAddressForm />
    </div>
  );
}
