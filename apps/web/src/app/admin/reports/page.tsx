import { ReportsWorkspace } from './reports-workspace';

export const metadata = { title: 'Admin · Reports' };

export default async function ReportsPage() {
  return (
    <div className="p-6">
      <ReportsWorkspace />
    </div>
  );
}
