import { notFound } from 'next/navigation';
import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { loadModuleForEditor } from '@/server/training/authoring';
import { ModuleEditor } from './module-editor';

export const metadata = { title: 'Platform · Edit training module' };
export const dynamic = 'force-dynamic';

export default async function TrainingModuleEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireCapability('cms:read');
  const { id } = await params;
  const mod = await loadModuleForEditor(prisma, id);
  if (!mod) notFound();
  return <ModuleEditor initial={JSON.parse(JSON.stringify(mod))} canEdit={session.user.role === 'SUPER_ADMIN'} />;
}
