import { ModuleViewer } from '@/components/training/module-viewer';

export const dynamic = 'force-dynamic';

export default async function RiderTrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModuleViewer apiBase="/api/rider/training" moduleId={id} backHref="/rider/training" />;
}
