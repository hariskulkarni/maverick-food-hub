import { MenuWorkspace } from '../../menu/menu-workspace';

export const metadata = { title: 'Admin · Storefront CMS · Menu' };
export const dynamic = 'force-dynamic';

export default async function CmsMenuTab() {
  return (
    <div className="p-6">
      <MenuWorkspace />
    </div>
  );
}
