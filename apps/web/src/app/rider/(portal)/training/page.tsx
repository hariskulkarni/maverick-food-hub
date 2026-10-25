/**
 * Rider training library — the shared web training UI (also used by restaurant
 * staff) pointed at the rider endpoints /api/rider/training/*, so progress,
 * quizzes and certificates are the same records the app shows.
 */
import { TrainingLibrary } from '@/components/training/training-library';
import { PageHeaderStatic } from '../../_components/page-header-static';

export const dynamic = 'force-dynamic';

export default function RiderTrainingPage() {
  return (
    <div className="space-y-5">
      <PageHeaderStatic title="Training" intro="Short lessons and quizzes. Required modules must be passed to keep taking deliveries." />
      <TrainingLibrary apiBase="/api/rider/training" moduleBase="/rider/training" />
    </div>
  );
}
