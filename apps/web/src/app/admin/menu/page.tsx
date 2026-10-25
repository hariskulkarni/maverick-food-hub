import { MenuWorkspace } from './menu-workspace';
import { HelpButton } from '@/components/help/help-button';

export const metadata = { title: 'Admin · Menu' };

export default async function AdminMenuPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="display text-2xl font-semibold">Menu</h1>
        <HelpButton appArea="admin.menu" />
      </div>
      <MenuWorkspace />
    </div>
  );
}
