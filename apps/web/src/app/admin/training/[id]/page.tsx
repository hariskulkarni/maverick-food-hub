import { ModuleViewer } from '@/components/training/module-viewer';

export const metadata = { title: 'Training module' };
export const dynamic = 'force-dynamic';

export default async function AdminTrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="p-4 sm:p-6">
      <ModuleViewer apiBase="/api/staff/training" moduleId={id} backHref="/admin/training" />
    </div>
  );
}
