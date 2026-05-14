import { NewBranchForm } from './form';
export const metadata = { title: 'Admin · New branch' };

export default function NewBranchPage() {
  return (
    <div className="p-6 max-w-xl">
      <h1 className="display text-2xl font-semibold mb-4">Open a new branch</h1>
      <NewBranchForm />
    </div>
  );
}
