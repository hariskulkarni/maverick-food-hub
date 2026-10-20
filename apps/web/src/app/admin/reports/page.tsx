import { ReportsWorkspace } from './reports-workspace';

export const metadata = { title: 'Admin · Reports' };

export default async function ReportsPage() {
  return (
    <div className="p-4 sm:p-6">
      <ReportsWorkspace />
    </div>
  );
}
