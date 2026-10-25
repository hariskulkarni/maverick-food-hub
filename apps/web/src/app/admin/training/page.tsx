import { TrainingLibrary } from '@/components/training/training-library';
import { TeamTraining } from '@/components/training/team-training';

export const metadata = { title: 'Training' };
export const dynamic = 'force-dynamic';

export default function AdminTrainingPage() {
  return (
    <div className="max-w-6xl space-y-8 p-4 sm:p-6">
      <header>
        <h1 className="display text-3xl font-semibold">Training</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Flavrly training for restaurant admins and kitchen teams. Finish required modules and pass the quiz to earn a certificate.
        </p>
      </header>
      <TrainingLibrary apiBase="/api/staff/training" moduleBase="/admin/training" />
      <TeamTraining />
    </div>
  );
}
