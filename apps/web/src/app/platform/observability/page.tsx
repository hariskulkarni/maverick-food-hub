import { ObservabilityClient } from './observability-client';

export const metadata = { title: 'Platform · Observability' };
export const dynamic = 'force-dynamic';

export default function ObservabilityPage() {
  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <header>
        <h1 className="display text-3xl font-semibold">Observability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live platform health, dependency probes, and the unresolved error feed across every area.
        </p>
      </header>
      <ObservabilityClient />
    </div>
  );
}
