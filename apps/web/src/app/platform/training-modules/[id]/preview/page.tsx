/**
 * Super-admin preview of a training module — renders the lesson exactly as a
 * rider would see it (block-by-block, with quizzes + checklists + animations),
 * so super-admins can sense-check content before activating a module.
 */
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseContentBlocks } from '@/server/training-cms';
import { LessonPlayer } from '@/components/training/lesson-player';
import { ArrowLeft, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const metadata = { title: 'Platform · Training preview' };
export const dynamic = 'force-dynamic';

export default async function TrainingModulePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
    redirect('/login?next=/platform/training-modules&mode=admin');
  }
  const { id } = await params;
  const mod = await prisma.trainingModule.findUnique({ where: { id } });
  if (!mod) return notFound();

  const blocks = parseContentBlocks(mod.contentBlocks);

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-40">
        <div className="container max-w-3xl py-3 flex items-center gap-3">
          <Link href="/platform/training-modules" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> All modules
          </Link>
          <Badge variant="muted" className="ml-auto"><Eye className="size-3 mr-1" /> Preview · no progress saved</Badge>
          {mod.isRequired && <Badge variant="warning">Required</Badge>}
          <Badge variant={mod.isActive ? 'success' : 'muted'}>{mod.isActive ? 'Active' : 'Inactive'}</Badge>
        </div>
      </header>

      <div className="container px-4 md:px-6 pt-6">
        {blocks.length === 0 ? (
          <div className="mx-auto max-w-3xl rounded-xl border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            This module has no block-based content yet — it&apos;s still on the legacy plain-text body. Open the editor and
            run the upgrade script, or add blocks manually.
          </div>
        ) : (
          <LessonPlayer
            moduleId={mod.id}
            title={mod.title}
            summary={mod.summary}
            heroImageUrl={mod.heroImageUrl}
            durationMin={mod.durationMin}
            blocks={blocks}
            mode="preview"
          />
        )}
      </div>
    </div>
  );
}
