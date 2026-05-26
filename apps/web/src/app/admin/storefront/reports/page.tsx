import { ReportsWorkspace } from '../../reports/reports-workspace';

export const metadata = { title: 'Admin · Storefront CMS · Reports' };
export const dynamic = 'force-dynamic';

export default async function CmsReportsTab() {
  // Header is provided by the hub layout, so suppress the workspace's own H1.
  return <ReportsWorkspace showHeader={false} />;
}
