import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TrainingLibrary } from '@/components/training/training-library';

export const metadata = { title: 'Kitchen training' };
export const dynamic = 'force-dynamic';

export default function KitchenTrainingPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/kitchen" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Kitchen board
      </Link>
      <header>
        <h1 className="display text-2xl font-semibold sm:text-3xl">Training</h1>
        <p className="mt-1 text-sm text-muted-foreground">Food safety and kitchen workflow training from Flavrly.</p>
      </header>
      <TrainingLibrary apiBase="/api/staff/training" moduleBase="/kitchen/training" />
    </div>
  );
}
