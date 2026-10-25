import { requireSuperAdmin } from '@/server/tenancy';
import { HelpCms } from './help-cms';

export const metadata = { title: 'Platform · Help center' };
export const dynamic = 'force-dynamic';

export default async function PlatformHelpPage() {
  await requireSuperAdmin();
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Help center</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Author help articles for restaurant admins, kitchen staff, riders and customers. Published articles appear in
          /admin/help, /kitchen/help, the rider app Help screen and /faq.
        </p>
      </header>
      <HelpCms />
    </div>
  );
}
