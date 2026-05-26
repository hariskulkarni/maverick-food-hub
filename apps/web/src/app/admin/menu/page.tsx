import { MenuWorkspace } from './menu-workspace';

export const metadata = { title: 'Admin · Menu' };

export default async function AdminMenuPage() {
  return (
    <div className="p-6">
      <h1 className="display text-2xl font-semibold mb-4">Menu</h1>
      <MenuWorkspace />
    </div>
  );
}
