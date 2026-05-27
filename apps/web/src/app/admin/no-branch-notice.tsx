import Link from 'next/link';
import { Building2 } from 'lucide-react';

/**
 * Friendly empty state shown when the active restaurant has no active branch
 * yet — instead of crashing the page with Prisma's P2025 ("No Branch found").
 * Most admin surfaces are branch-scoped, so without a branch there's nothing to
 * render; we point the admin at where to add one.
 */
export function NoBranchNotice({ title = 'No active branch yet' }: { title?: string }) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed bg-muted/30 p-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Building2 className="size-6" />
        </div>
        <h1 className="display mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This outlet doesn’t have an active branch, so there’s nothing to show here yet. Add or activate a
          branch to get started.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Link href="/admin/branches" className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            Manage branches
          </Link>
          <Link href="/admin/settings" className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
            Open settings
          </Link>
        </div>
      </div>
    </div>
  );
}
