import { ReportsWorkspace } from './reports-workspace';
import { HelpButton } from '@/components/help/help-button';

export const metadata = { title: 'Admin · Reports' };

export default async function ReportsPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-2 flex justify-end">
        <HelpButton appArea="admin.reports" />
      </div>
      <ReportsWorkspace />
    </div>
  );
}
