import { ModuleViewer } from '@/components/training/module-viewer';

export const metadata = { title: 'Kitchen training' };
export const dynamic = 'force-dynamic';

export default async function KitchenTrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModuleViewer apiBase="/api/staff/training" moduleId={id} backHref="/kitchen/training" />;
}
